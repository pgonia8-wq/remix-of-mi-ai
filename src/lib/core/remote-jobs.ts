import type { Core } from "./index";
import { getAdapter } from "./adapters";
import { credentialsFor } from "./executor";
import { ProviderError } from "../providers";

const locks = new Set<string>();
/** Poll only: this path never resubmits a billed generation. */
export async function pollRemoteJob(core: Core, projectId: string, id: string) {
  const lock = `${projectId}:${id}`;
  if (locks.has(lock)) throw new Error("Consulta ya activa.");
  locks.add(lock);
  try {
    const j = await core.jobs.get(projectId, id);
    if (!j?.provider_id || !j.remote_id || !["processing", "interrupted", "recovery_required"].includes(j.status)) throw new Error("Trabajo remoto no disponible.");
    const { creds, adapter: adapterId } = await credentialsFor(core.repo, j.provider_id);
    const adapter = getAdapter(adapterId);
    if (!adapter.poll) throw new Error("Este proveedor no admite consultar el trabajo.");
    if (j.status !== "processing") await core.jobs.transition(projectId, id, "processing", { phase: "accepted" });
    let result;
    try { result = await adapter.poll(creds, j.remote_id); }
    catch (e) {
      if (e instanceof ProviderError && e.code === "parameters") {
        await core.jobs.transition(projectId, id, "failed", { error: e.message });
        await core.jobs.finishAttempt(projectId, id, "failed", e.message);
      }
      throw e;
    }
    if (result.kind === "pending") {
      await core.repo.sql.run("UPDATE jobs SET progress=?,updated_at=? WHERE project_id=? AND id=?", [result.progress ?? null, Date.now(), projectId, id]);
      return { pending: true, assets: [] };
    }
    if (result.kind !== "files" || !result.files.length) throw new Error("El proveedor no devolvió archivos completos.");
    const meta = JSON.parse(j.params ?? "{}") as Record<string, unknown>;
    const saved = await core.repo.sql.all<{ id: string }>("SELECT id FROM assets WHERE project_id=? AND job_id=?", [projectId, id]);
    // Recover a crash after an asset commit without registering duplicate output.
    // Per-output dedupe: resume after the files already committed (a crash mid multi-file save loses nothing).
    for (const file of result.files.slice(saved.length)) {
      await core.assets.put(projectId, (async function* () { yield file.bytes; })(), {
        kind: file.mime === "model/gltf-binary" ? "model3d" : file.mime.split("/")[0] ?? "document", mime: file.mime, name: file.name,
        providerId: j.provider_id, modelId: j.model_id, capability: j.capability_id, jobId: id,
        prompt: typeof meta["prompt"] === "string" ? meta["prompt"] : null,
        parentId: typeof meta["parentAssetId"] === "string" ? meta["parentAssetId"] : null, params: meta,
      });
    }
    await core.jobs.finishAttempt(projectId, id, "completed");
    await core.jobs.transition(projectId, id, "completed", { phase: "received", progress: 1, error: null, recovery: null });
    return { pending: false, assets: await core.repo.sql.all<{ id: string }>("SELECT id FROM assets WHERE project_id=? AND job_id=?", [projectId, id]) };
  } finally { locks.delete(lock); }
}
export async function cancelRemoteJob(core: Core, projectId: string, id: string) {
  if (locks.has(`${projectId}:${id}`)) throw new Error("Espera a que termine la consulta.");
  const job = await core.jobs.get(projectId, id);
  if (!job?.provider_id || !job.remote_id || job.status !== "processing") throw new Error("Trabajo no cancelable.");
  const { creds, adapter: adapterId } = await credentialsFor(core.repo, job.provider_id);
  const adapter = getAdapter(adapterId);
  if (!adapter.cancel) throw new Error("Este proveedor no admite cancelar desde MI AI.");
  await adapter.cancel(creds, job.remote_id);
  await core.jobs.transition(projectId, id, "cancelled");
  await core.jobs.finishAttempt(projectId, id, "cancelled");
}