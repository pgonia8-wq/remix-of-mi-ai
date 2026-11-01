import type { Core } from "./index";
import { credentialsFor } from "./executor";
import { azureVideoForm, azureVideoUrl, runAzureVideo } from "./adapters/azure-video";
import { ProviderError } from "../providers";
import { pollRemoteJob } from "./remote-jobs";

/** Billed draft verification is a durable project job, not an in-memory polling loop. */
export async function submitAzureVideoTest(core: Core, projectId: string, providerId: string, model: string) {
  const { creds, adapter } = await credentialsFor(core.repo, providerId);
  if (adapter !== "azure_openai") throw new Error("Selecciona una conexión Azure.");
  const request = { capability: "video.generate", model, prompt: "A blue ball on a table, static camera", params: { seconds: 4, ratio: "1280:720" } };
  azureVideoUrl(creds); azureVideoForm(request);
  const job = await core.jobs.create(projectId, { capability: "video.generate", providerId, params: { ...request.params, prompt: request.prompt, verificationModel: model } });
  await core.jobs.markSent(projectId, job.id);
  try {
    const result = await runAzureVideo(creds, request);
    if (result.kind !== "remote") throw new Error("Azure no confirmó el trabajo de video.");
    await core.jobs.transition(projectId, job.id, "processing", { phase: "accepted", remote_id: result.remoteId });
    return job.id;
  } catch (error) {
    const rejected = error instanceof ProviderError && error.httpStatus !== undefined;
    const message = rejected ? error.message : "Envío no confirmado: revisa Azure antes de repetir una prueba que pudo tener costo.";
    await core.jobs.finishAttempt(projectId, job.id, rejected ? "failed" : "unknown", message);
    await core.jobs.transition(projectId, job.id, rejected ? "failed" : "recovery_required", { phase: rejected ? "sent" : "unknown", error: message, recovery: rejected ? null : message });
    throw new Error(message);
  }
}

export async function finishAzureVideoTest(core: Core, projectId: string, jobId: string) {
  const job = await core.jobs.get(projectId, jobId);
  if (!job?.provider_id || job.capability_id !== "video.generate") throw new Error("Prueba de video inexistente en este proyecto.");
  const meta = JSON.parse(job.params ?? "{}") as Record<string, unknown>;
  if (typeof meta["verificationModel"] !== "string") throw new Error("Este trabajo no es una prueba de modelo.");
  if (job.status !== "completed") {
    const result = await pollRemoteJob(core, projectId, jobId);
    if (result.pending) return false;
  }
  const assets = await core.repo.sql.all<{ id: string }>("SELECT id FROM assets WHERE project_id=? AND job_id=? AND mime='video/mp4'", [projectId, jobId]);
  if (!assets.length) throw new Error("No se recibió un video válido para verificar.");
  const id = await core.repo.registry.upsertModel({ providerId: job.provider_id, remoteId: meta["verificationModel"], source: "manual" });
  const model = (await core.repo.registry.listModels()).find(m => m.id === id);
  await core.repo.registry.setModelCapabilities(id, [...new Set([...(model?.capabilities ?? []), "video.generate"])]);
  await core.repo.registry.recordTest(id, "video.generate", true, 200, "MP4 real recibido desde Azure.");
  return true;
}