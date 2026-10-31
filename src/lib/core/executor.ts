// Runs one capability through Router → Job Manager → Adapter → Asset Store.
import type { Repo } from "../db/repo";
import { ProviderError } from "../providers";
import { getAdapter } from "./adapters";
import type { AdapterCredentials, InputFile, RunResult } from "./adapters/types";
import type { AssetStore, Asset } from "./asset-store";
import type { JobManager } from "./jobs";
import type { ModelWithCaps } from "./registry";

export type ExecResult = { jobId: string; text?: string; assets: Asset[] };

export async function credentialsFor(repo: Repo, providerId: string): Promise<{ creds: AdapterCredentials; adapter: string }> {
  const [p] = await repo.sql.all<{ id: string; kind: string; endpoint: string | null; deployment: string | null; model: string; api_version: string | null; extra_params: string | null }>(
    `SELECT p.id, p.kind, p.endpoint, p.deployment, p.model, p.api_version, p.extra_params FROM auth_refs a JOIN providers p ON p.id=a.legacy_provider_id WHERE a.provider_id=?`, [providerId]);
  if (!p) throw new ProviderError("auth", "Proveedor sin credencial registrada.");
  const [r] = await repo.sql.all<{ adapter: string }>(`SELECT adapter FROM providers_registry WHERE id=?`, [providerId]);
  return {
    adapter: r?.adapter ?? `text:${p.kind}`,
    creds: { kind: p.kind as AdapterCredentials["kind"], endpoint: p.endpoint, apiKey: await repo.getProviderSecret(p.id), deployment: p.deployment, apiVersion: p.api_version, model: p.model, extraParams: p.extra_params },
  };
}

/** Errors with an HTTP response mean the provider rejected the request (safe to mark failed); no response = ambiguous. */
function ambiguous(e: unknown) { return e instanceof ProviderError && (e.code === "network" || e.code === "timeout") && e.httpStatus === undefined; }

export async function execute(deps: { repo: Repo; jobs: JobManager; assets: AssetStore }, projectId: string, model: ModelWithCaps,
  req: { capability: string; prompt?: string; params?: Record<string, unknown>; files?: InputFile[]; parentAssetId?: string | null; signal?: AbortSignal; existingJobId?: string }): Promise<ExecResult> {
  if (!model.capabilities.includes(req.capability)) throw new ProviderError("parameters", `El modelo «${model.name}» no admite «${req.capability}». No se ejecutó ninguna solicitud.`);
  const { creds, adapter: adapterId } = await credentialsFor(deps.repo, model.provider_id);
  const adapter = getAdapter(adapterId);
  if (!adapter.supports(req.capability)) throw new ProviderError("parameters", `El adaptador ${adapter.label} no implementa «${req.capability}». No se ejecutó ninguna solicitud.`);
  const job = req.existingJobId ? (await deps.jobs.get(projectId, req.existingJobId))! : await deps.jobs.create(projectId, { capability: req.capability, providerId: model.provider_id, modelId: model.id, params: { prompt: req.prompt, ...req.params } });
  await deps.jobs.markSent(projectId, job.id);
  let result: RunResult;
  try {
    result = await adapter.run(creds, { capability: req.capability, model: model.remote_id, ...(req.prompt !== undefined ? { prompt: req.prompt } : {}), ...(req.params ? { params: req.params } : {}), ...(req.files ? { files: req.files } : {}), idempotencyKey: job.idempotency_key, ...(req.signal ? { signal: req.signal } : {}) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await deps.jobs.finishAttempt(projectId, job.id, ambiguous(e) ? "unknown" : "failed", msg);
    if (ambiguous(e)) await deps.jobs.transition(projectId, job.id, "recovery_required", { phase: "unknown", error: msg, recovery: "Sin respuesta del proveedor: pudo haber procesado (y cobrado) la solicitud. Revisa tu cuenta antes de reintentar." });
    else await deps.jobs.transition(projectId, job.id, "failed", { error: msg });
    throw e;
  }
  await deps.jobs.transition(projectId, job.id, "processing", { phase: "accepted" });
  const saved: Asset[] = [];
  if (result.kind === "files") {
    for (const f of result.files) {
      saved.push(await deps.assets.put(projectId, (async function* () { yield f.bytes; })(), {
        kind: f.mime.split("/")[0]!, mime: f.mime, name: f.name, providerId: model.provider_id, modelId: model.id, capability: req.capability,
        prompt: req.prompt ?? null, params: req.params ?? null, jobId: job.id, parentId: req.parentAssetId ?? null,
      }));
    }
  }
  await deps.jobs.finishAttempt(projectId, job.id, "completed");
  await deps.jobs.transition(projectId, job.id, "completed", { phase: "received", progress: 1 });
  return { jobId: job.id, ...(result.kind === "text" ? { text: result.text } : result.kind === "files" && result.text ? { text: result.text } : {}), assets: saved };
}

/** Minimal REAL operation per capability for "Probar operación". Results are not stored as assets. */
export async function testOperation(repo: Repo, model: ModelWithCaps, capability: string): Promise<{ ok: boolean; httpStatus: number | null; message: string }> {
  try {
    const { creds, adapter: id } = await credentialsFor(repo, model.provider_id);
    const adapter = getAdapter(id);
    if (!adapter.supports(capability)) return { ok: false, httpStatus: null, message: `El adaptador ${adapter.label} no implementa esta operación.` };
    const prompts: Record<string, { prompt: string; params?: Record<string, unknown> }> = {
      chat: { prompt: "Responde solo: OK" },
      "image.generate": { prompt: "Un círculo azul sobre fondo blanco, ilustración simple", params: { size: "1024x1024", quality: "low", n: 1 } },
      "audio.tts": { prompt: "Prueba de MI AI." },
    };
    const p = prompts[capability];
    if (!p) return { ok: false, httpStatus: null, message: "Esta operación necesita un archivo de entrada; pruébala desde la Biblioteca." };
    const r = await adapter.run(creds, { capability, model: model.remote_id, prompt: p.prompt, ...(p.params ? { params: p.params } : {}) });
    const ok = (r.kind === "text" && r.text.trim().length > 0) || (r.kind === "files" && r.files.length > 0 && r.files[0]!.bytes.length > 100);
    return ok ? { ok: true, httpStatus: 200, message: "Operación real completada." } : { ok: false, httpStatus: 200, message: "Respuesta vacía." };
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, httpStatus: e.httpStatus ?? null, message: e.technical ? `${e.message} — ${e.technical}` : e.message };
    return { ok: false, httpStatus: null, message: "Error inesperado" };
  }
}
