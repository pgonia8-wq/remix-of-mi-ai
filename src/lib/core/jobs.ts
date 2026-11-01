// Persistent job manager with a controlled state machine and conservative, non-duplicating recovery.
import type { SqlDb } from "../db/sql";

export type JobStatus = "queued" | "submitting" | "processing" | "completed" | "failed" | "cancelled" | "interrupted" | "recovery_required";
/** created → sent → accepted → received | unknown */
export type JobPhase = "created" | "sent" | "accepted" | "received" | "unknown";
export type Job = {
  id: string; project_id: string; capability_id: string; provider_id: string | null; model_id: string | null; model_version: string | null;
  remote_id: string | null; idempotency_key: string; phase: JobPhase; status: JobStatus; progress: number | null; params: string | null;
  error: string | null; attempts: number; recovery: string | null; created_at: number; updated_at: number;
};

export const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["submitting", "cancelled"],
  submitting: ["processing", "completed", "failed", "interrupted", "recovery_required"],
  processing: ["completed", "failed", "cancelled", "interrupted", "recovery_required"],
  interrupted: ["processing", "recovery_required", "failed", "queued"],
  recovery_required: ["queued", "processing", "completed", "failed", "cancelled"],
  failed: ["queued"],
  completed: [],
  cancelled: [],
};

export class JobError extends Error {}
const uid = () => crypto.randomUUID();
const now = () => Date.now();
function need(projectId: string) { if (!projectId) throw new JobError("projectId requerido"); }

export class JobManager {
  constructor(private db: SqlDb) {}

  async create(projectId: string, j: { capability: string; providerId?: string | null; modelId?: string | null; modelVersion?: string | null; params?: unknown }): Promise<Job> {
    need(projectId);
    const job: Job = {
      id: uid(), project_id: projectId, capability_id: j.capability, provider_id: j.providerId ?? null, model_id: j.modelId ?? null,
      model_version: j.modelVersion ?? null, remote_id: null, idempotency_key: uid(), phase: "created", status: "queued", progress: null,
      params: j.params === undefined ? null : JSON.stringify(j.params), error: null, attempts: 0, recovery: null, created_at: now(), updated_at: now(),
    };
    await this.db.run(
      `INSERT INTO jobs (id, project_id, capability_id, provider_id, model_id, model_version, remote_id, idempotency_key, phase, status, progress, params, error, attempts, recovery, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [job.id, projectId, job.capability_id, job.provider_id, job.model_id, job.model_version, null, job.idempotency_key, job.phase, job.status, null, job.params, null, 0, null, job.created_at, job.updated_at],
    );
    return job;
  }

  async get(projectId: string, id: string): Promise<Job | null> {
    need(projectId);
    return (await this.db.all<Job>(`SELECT * FROM jobs WHERE project_id=? AND id=?`, [projectId, id]))[0] ?? null;
  }
  list(projectId: string, status?: JobStatus) {
    need(projectId);
    return status
      ? this.db.all<Job>(`SELECT * FROM jobs WHERE project_id=? AND status=? ORDER BY created_at DESC`, [projectId, status])
      : this.db.all<Job>(`SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC`, [projectId]);
  }

  async transition(projectId: string, id: string, to: JobStatus, patch: Partial<Pick<Job, "phase" | "remote_id" | "progress" | "error" | "recovery">> = {}) {
    const j = await this.get(projectId, id);
    if (!j) throw new JobError("Trabajo no pertenece al proyecto");
    if (!TRANSITIONS[j.status].includes(to)) throw new JobError(`Transición no permitida: ${j.status} → ${to}`);
    await this.db.run(
      `UPDATE jobs SET status=?, phase=?, remote_id=?, progress=?, error=?, recovery=?, updated_at=? WHERE id=? AND project_id=?`,
      [to, patch.phase ?? j.phase, patch.remote_id !== undefined ? patch.remote_id : j.remote_id, patch.progress !== undefined ? patch.progress : j.progress,
        patch.error !== undefined ? patch.error : j.error, patch.recovery !== undefined ? patch.recovery : j.recovery, now(), id, projectId],
    );
  }

  /** Mark the request as sent BEFORE the network call, so a crash afterwards is known to be ambiguous. */
  async markSent(projectId: string, id: string) {
    const j = await this.get(projectId, id);
    if (!j) throw new JobError("Trabajo no pertenece al proyecto");
    if (!TRANSITIONS[j.status].includes("submitting")) throw new JobError(`Transición no permitida: ${j.status} → submitting`);
    // Compare-and-swap on (status, attempts): a concurrent second send cannot also pass.
    await this.db.run(`UPDATE jobs SET status='submitting', phase='sent', attempts=attempts+1, updated_at=? WHERE id=? AND project_id=? AND status=? AND attempts=?`, [now(), id, projectId, j.status, j.attempts]);
    const after = await this.get(projectId, id);
    if (!after || after.attempts !== j.attempts + 1 || after.status !== "submitting") throw new JobError("Este trabajo ya se está enviando. No se envió de nuevo.");
    await this.db.run(`INSERT INTO job_attempts (id, project_id, job_id, n, started_at) VALUES (?,?,?,?,?)`, [uid(), projectId, id, j.attempts + 1, now()]);
  }
  async finishAttempt(projectId: string, id: string, outcome: string, error?: string) {
    need(projectId);
    await this.db.run(`UPDATE job_attempts SET ended_at=?, outcome=?, error=? WHERE project_id=? AND job_id=? AND ended_at IS NULL`, [now(), outcome, error ?? null, projectId, id]);
  }

  /**
   * Called on app start. Jobs that were in flight:
   *  - phase created → never left the device → safe to re-queue.
   *  - remote id known and adapter can poll → interrupted (poll will resume).
   *  - otherwise → recovery_required (the provider may have accepted and billed it; ask the user).
   */
  async recoverOnStart(canPoll: (job: Job) => boolean): Promise<{ requeued: number; interrupted: number; needsUser: number }> {
    const live = await this.db.all<Job>(`SELECT * FROM jobs WHERE status IN ('submitting','processing')`);
    const r = { requeued: 0, interrupted: 0, needsUser: 0 };
    for (const j of live) {
      if (j.phase === "created") {
        await this.db.run(`UPDATE jobs SET status='queued', updated_at=? WHERE id=?`, [now(), j.id]); r.requeued++;
      } else if (j.remote_id && canPoll(j)) {
        await this.db.run(`UPDATE jobs SET status='interrupted', updated_at=? WHERE id=?`, [now(), j.id]); r.interrupted++;
      } else {
        await this.db.run(`UPDATE jobs SET status='recovery_required', phase='unknown', recovery=?, updated_at=? WHERE id=?`,
          ["La app se cerró después de enviar la solicitud; el proveedor pudo haberla aceptado. Confirma antes de reintentar para evitar un cobro doble.", now(), j.id]);
        r.needsUser++;
      }
      await this.db.run(`UPDATE job_attempts SET ended_at=?, outcome='interrupted' WHERE job_id=? AND ended_at IS NULL`, [now(), j.id]);
    }
    return r;
  }

  /** Retry is only automatic for failures known to happen before acceptance; otherwise needs explicit user confirmation. */
  async retry(projectId: string, id: string, userConfirmed: boolean) {
    const j = await this.get(projectId, id);
    if (!j) throw new JobError("Trabajo no pertenece al proyecto");
    if (j.status === "recovery_required" && !userConfirmed) throw new JobError("Este trabajo pudo haber sido aceptado por el proveedor. Confirma el reintento.");
    if (!["failed", "recovery_required", "interrupted"].includes(j.status)) throw new JobError(`No se puede reintentar un trabajo ${j.status}`);
    await this.transition(projectId, id, "queued", { phase: "created", error: null, recovery: null });
  }

  async delete(projectId: string, id: string) {
    need(projectId);
    await this.db.run(`DELETE FROM job_attempts WHERE project_id=? AND job_id=?`, [projectId, id]);
    await this.db.run(`DELETE FROM jobs WHERE project_id=? AND id=?`, [projectId, id]);
  }
}
