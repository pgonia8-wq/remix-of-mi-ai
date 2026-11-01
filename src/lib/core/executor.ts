// Runs one capability through Router → Job Manager → Adapter → Asset Store.
import type { Repo } from "../db/repo";
import { ProviderError } from "../providers";
import { getAdapter } from "./adapters";
import type { AdapterCredentials, InputFile, RunResult } from "./adapters/types";
import type { AssetStore, Asset } from "./asset-store";
import type { JobManager } from "./jobs";
import type { ModelWithCaps } from "./registry";
import { TEST_PNG_B64 } from "./adapters/vision";
import { testWav } from "./adapters/audio";
import { b64ToBytes } from "./adapters/types";
import { requestIssues } from "./request-compatibility";
import { budgetGate, recordUsage, usageFor } from "./costs";

export type ExecResult = { jobId: string; pending?: boolean; text?: string; assets: Asset[]; vectors?: number[][]; results?: import("./adapters/types").SearchResult[] };

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

/** Only an explicit client-error rejection establishes non-acceptance. Successful-response parsing,
 * server errors, cancellation and unknown errors after sending must never permit an automatic replay. */
export function ambiguous(e: unknown) {
  if (!(e instanceof ProviderError)) return true;
  const status = e.httpStatus;
  return status === undefined || status < 400 || status >= 500 || status === 408;
}

export async function execute(deps: { repo: Repo; jobs: JobManager; assets: AssetStore }, projectId: string, model: ModelWithCaps,
  req: { capability: string; prompt?: string; params?: Record<string, unknown>; files?: InputFile[]; parentAssetId?: string | null; saveText?: boolean; signal?: AbortSignal; existingJobId?: string }): Promise<ExecResult> {
  const current = (await deps.repo.registry.listModels()).find((m) => m.id === model.id);
  if (!current || current.status !== "active" || !current.provider_enabled || !current.capabilities.includes(req.capability) || current.provider_id !== model.provider_id || current.remote_id !== model.remote_id) throw new ProviderError("parameters", "El modelo ya no está disponible para esta operación. Selecciónalo nuevamente; no se envió ninguna solicitud.");
  const issues = requestIssues(await deps.repo.registry.getCapability(req.capability), { prompt: req.prompt, params: req.params, files: req.files?.map((f) => ({ mime: f.mime, size: f.bytes.length })) });
  if (issues.length) throw new ProviderError("parameters", issues.join(" "));
  const currentAdapter = getAdapter(current.adapter_id ?? (current.provider_kind === "azure" ? "azure_openai" : current.provider_kind));
  if (!currentAdapter.supports(req.capability)) throw new ProviderError("parameters", `El adaptador ${currentAdapter.label} no implementa «${req.capability}». No se accedió a credenciales ni se creó un trabajo.`);
  if (!model.capabilities.includes(req.capability)) throw new ProviderError("parameters", `El modelo «${model.name}» no admite «${req.capability}». No se ejecutó ninguna solicitud.`);
  if (!req.existingJobId) await budgetGate(deps.repo, projectId, model.remote_id, usageFor(req.capability, req.prompt, req.params));
  const { creds, adapter: adapterId } = await credentialsFor(deps.repo, model.provider_id);
  const adapter = getAdapter(adapterId);
  if (!adapter.supports(req.capability)) throw new ProviderError("parameters", `El adaptador ${adapter.label} no implementa «${req.capability}». No se ejecutó ninguna solicitud.`);
  const job = req.existingJobId ? await deps.jobs.get(projectId, req.existingJobId) : await deps.jobs.create(projectId, { capability: req.capability, providerId: model.provider_id, modelId: model.id, params: { prompt: req.prompt, ...req.params, parentAssetId: req.parentAssetId ?? null } });
  if (!job || job.model_id !== model.id || job.capability_id !== req.capability) throw new ProviderError("parameters", "Trabajo inexistente o incompatible.");
  if (job.remote_id) throw new ProviderError("parameters", "Este trabajo ya tiene un identificador remoto. Consulta su estado sin volver a enviar.");
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
  await recordUsage(deps.repo, projectId, { providerId: model.provider_id, model: model.remote_id, operation: req.capability, usage: usageFor(req.capability, req.prompt, req.params, { text: result.kind === "text" ? result.text : undefined, files: result.kind === "files" ? result.files.length : undefined }) }).catch(() => undefined);
  await deps.jobs.transition(projectId, job.id, "processing", { phase: "accepted", ...(result.kind === "remote" ? { remote_id: result.remoteId } : {}) });
  if (result.kind === "remote") return { jobId: job.id, pending: true, assets: [] };
  const saved: Asset[] = [];
  if (result.kind === "files") {
    for (const f of result.files) {
      saved.push(await deps.assets.put(projectId, (async function* () { yield f.bytes; })(), {
        kind: f.mime === "model/gltf-binary" ? "model3d" : f.mime.split("/")[0] ?? "document", mime: f.mime, name: f.name, providerId: model.provider_id, modelId: model.id, capability: req.capability,
        prompt: req.prompt ?? null, params: req.params ?? null, jobId: job.id, parentId: req.parentAssetId ?? null,
      }));
    }
  }
  if (result.kind === "text" && req.saveText) {
    // Text results (e.g. image analysis) are kept in the encrypted library, linked to their source asset.
    saved.push(await deps.assets.put(projectId, (async function* () { yield new TextEncoder().encode(result.text); })(), {
      kind: "text", mime: "text/plain", name: `${req.capability}-${new Date().toISOString().slice(0, 16)}.txt`, providerId: model.provider_id, modelId: model.id, capability: req.capability,
      prompt: req.prompt ?? null, params: req.params ?? null, jobId: job.id, parentId: req.parentAssetId ?? null,
    }));
  }
  await deps.jobs.finishAttempt(projectId, job.id, "completed");
  await deps.jobs.transition(projectId, job.id, "completed", { phase: "received", progress: 1 });
  if (result.kind === "vectors") return { jobId: job.id, assets: saved, vectors: result.vectors };
  if (result.kind === "search") return { jobId: job.id, assets: saved, results: result.results };
  return { jobId: job.id, ...(result.kind === "text" ? { text: result.text } : result.kind === "files" && result.text ? { text: result.text } : {}), assets: saved };
}

/** Minimal REAL operation per capability for "Probar operación". Results are not stored as assets. */
export async function testOperation(repo: Repo, model: ModelWithCaps, capability: string): Promise<{ ok: boolean; httpStatus: number | null; message: string }> {
  const { creds, adapter } = await credentialsFor(repo, model.provider_id);
  return testDraftOperation(adapter, creds, model.remote_id, capability);
}

export async function testDraftOperation(adapterId: string, creds: AdapterCredentials, remoteId: string, capability: string): Promise<{ ok: boolean; httpStatus: number | null; message: string }> {
  try {
    const adapter = getAdapter(adapterId);
    if (!adapter.supports(capability)) return { ok: false, httpStatus: null, message: `El adaptador ${adapter.label} no implementa esta operación.` };
    const prompts: Record<string, { prompt: string; params?: Record<string, unknown> }> = {
      chat: { prompt: "Responde solo: OK" },
      vision: { prompt: "¿De qué color es esta imagen? Responde con una palabra." },
      "image.generate": { prompt: "Un círculo azul sobre fondo blanco, ilustración simple", params: { size: "1024x1024", quality: "low", n: 1 } },
      "audio.tts": { prompt: "Prueba de MI AI." },
      embedding: { prompt: "Prueba de MI AI" },
      "research.web": { prompt: "MI AI asistente privado Android" },
    };
    const audioCaps = ["audio.transcribe", "audio.translate"];
    if (audioCaps.includes(capability)) {
      const r = await adapter.run(creds, { capability, model: remoteId, files: [{ bytes: testWav(), mime: "audio/wav", name: "prueba.wav" }], params: { allowEmpty: true } });
      return r.kind === "text" ? { ok: true, httpStatus: 200, message: "Operación real completada (el proveedor procesó el audio de prueba)." } : { ok: false, httpStatus: 200, message: "Respuesta inválida." };
    }
    const imageIn = ["vision", "image.edit", "image.upscale", "image.remove_bg"];
    const p = prompts[capability] ?? (imageIn.includes(capability) ? { prompt: capability === "image.edit" ? "Cambia el color a rojo." : "" } : undefined);
    if (!p) return { ok: false, httpStatus: null, message: "Esta operación necesita un archivo propio; pruébala desde la Biblioteca." };
    const files = imageIn.includes(capability) ? [{ bytes: b64ToBytes(TEST_PNG_B64), mime: "image/png", name: "prueba.png" }] : undefined;
    const r = await adapter.run(creds, { capability, model: remoteId, prompt: p.prompt, ...(p.params ? { params: p.params } : {}), ...(files ? { files } : {}) });
    const ok = (r.kind === "vectors" && r.vectors.length === 1) || (r.kind === "search" && r.results.length > 0) || (r.kind === "text" && r.text.trim().length > 0) || (r.kind === "files" && r.files.some(file => file.bytes.length > 100));
    return ok ? { ok: true, httpStatus: 200, message: "Operación real completada." } : { ok: false, httpStatus: 200, message: "Respuesta vacía." };
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, httpStatus: e.httpStatus ?? null, message: e.technical ? `${e.message} — ${e.technical}` : e.message };
    return { ok: false, httpStatus: null, message: "Error inesperado" };
  }
}
