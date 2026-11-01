// Review triggers on the existing Android alarm path. A trigger only surfaces a run for review; it never
// advances a run, calls a provider or approves anything.
import type { Repo } from "../db/repo";
import { isNative } from "../app-db";
import { MiaiSchedule } from "./native-schedules";

export type TriggerKind = "reminder" | "prepared" | "pending_review" | "paused" | "node_offline";
export const AUTO_PREFIX = "auto:";
export async function scheduleReview(repo: Repo, p: string, runId: string, dueAt: number, kind: TriggerKind, note = "") {
  if (!p) throw new Error("projectId requerido");
  const [r] = await repo.sql.all("SELECT id FROM auto_runs WHERE project_id=? AND id=?", [p, runId]);
  if (!r) throw new Error("Ejecución ajena al proyecto");
  const id = crypto.randomUUID();
  await repo.sql.run("INSERT INTO schedules VALUES (?,?,?,?,?,'scheduled',NULL,?)", [id, p, `${AUTO_PREFIX}${runId}`, dueAt, JSON.stringify({ kind, note: note.slice(0, 300) }), Date.now()]);
  if (isNative()) await MiaiSchedule.schedule({ id, dueAt });
  return id;
}
/** Due review triggers become inbox items; the run itself is untouched. */
export async function dueReviews(repo: Repo, p: string, now = Date.now()) {
  if (!p) throw new Error("projectId requerido");
  const due = await repo.sql.all<{ id: string; workflow_id: string; input: string; due_at: number }>("SELECT id, workflow_id, input, due_at FROM schedules WHERE project_id=? AND status='scheduled' AND workflow_id LIKE 'auto:%' AND due_at<=?", [p, now]);
  for (const d of due) await repo.sql.run("UPDATE schedules SET status='review' WHERE id=?", [d.id]);
  return due.map((d) => ({ id: d.id, runId: d.workflow_id.slice(AUTO_PREFIX.length), ...(JSON.parse(d.input) as { kind: TriggerKind; note: string }) }));
}
