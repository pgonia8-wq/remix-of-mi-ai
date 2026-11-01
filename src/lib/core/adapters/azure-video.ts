// Azure Sora 2 v1 video contract, not a universal Foundry media API.
// https://learn.microsoft.com/en-us/azure/foundry/reference/rest/video-generation-create-video
import { ProviderError } from "../../providers";
import { call, requireKey } from "./http";
import type { AdapterCredentials, RunRequest, RunResult } from "./types";

export const azureVideoSupport = { async: true, cancel: false, poll: true, recover: true, idempotencyHeader: null };

export function azureVideoUrl(credentials: AdapterCredentials, id?: string, content = false) {
  let endpoint: URL;
  try { endpoint = new URL(credentials.endpoint?.trim() ?? ""); }
  catch { throw new ProviderError("endpoint", "URL de Azure video incorrecta."); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new ProviderError("endpoint", "Azure video requiere HTTPS sin credenciales ni parámetros en la URL.");
  if (!/^\/openai\/v1(?:\/(?:videos|chat\/completions))?\/?$/.test(endpoint.pathname)) throw new ProviderError("endpoint", "Este contrato de video requiere la URL /openai/v1 de Azure; no se convirtió una API clásica automáticamente.");
  if (id !== undefined && !/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new ProviderError("parameters", "Identificador de video inválido.");
  return `${endpoint.origin}/openai/v1/videos${id === undefined ? "" : `/${encodeURIComponent(id)}${content ? "/content" : ""}`}`;
}

export function azureVideoForm(request: RunRequest) {
  const prompt = request.prompt?.trim();
  if (!prompt) throw new ProviderError("parameters", "Describe el video.");
  if (!request.model.trim()) throw new ProviderError("model", "Indica el modelo/deployment de video provisionado en Azure.");
  const seconds = Number(request.params?.["seconds"] ?? 4);
  if (![4, 8, 12].includes(seconds)) throw new ProviderError("parameters", "Azure Sora 2 admite duraciones de 4, 8 o 12 segundos.");
  const size = String(request.params?.["size"] ?? request.params?.["ratio"] ?? "1280x720").replace(":", "x");
  if (!["720x1280", "1280x720", "1024x1792", "1792x1024"].includes(size)) throw new ProviderError("parameters", "Tamaño de video no admitido por el contrato Azure Sora 2.");
  // Reference-file schemas vary between contracts. Never silently discard input.
  if (request.files?.length) throw new ProviderError("parameters", "Este contrato Azure de video admite texto; referencia de imagen requiere un contrato de entrada verificado.");
  const form = new FormData();
  form.set("model", request.model.trim()); form.set("prompt", prompt); form.set("seconds", String(seconds)); form.set("size", size);
  return form;
}

export async function runAzureVideo(credentials: AdapterCredentials, request: RunRequest): Promise<RunResult> {
  const url = azureVideoUrl(credentials);
  const form = azureVideoForm(request);
  const key = requireKey(credentials.apiKey);
  const response = await call(url, { method: "POST", headers: { "api-key": key }, body: form, credentials: "omit", redirect: "error", signal: request.signal ?? null }, key, 30_000);
  const data = await response.json();
  if (typeof data?.id !== "string") throw new ProviderError("parameters", "Azure no confirmó el identificador del video.");
  azureVideoUrl(credentials, data.id);
  return { kind: "remote", remoteId: data.id };
}

export async function pollAzureVideo(credentials: AdapterCredentials, id: string): Promise<RunResult | { kind: "pending"; progress?: number }> {
  const url = azureVideoUrl(credentials, id);
  const key = requireKey(credentials.apiKey);
  const init = { headers: { "api-key": key }, credentials: "omit" as const, redirect: "error" as const };
  const data = await (await call(url, init, key, 30_000)).json();
  if (["queued", "in_progress"].includes(data?.status)) return { kind: "pending", ...(Number.isFinite(data.progress) ? { progress: Math.max(0, Math.min(1, data.progress / 100)) } : {}) };
  if (data?.status !== "completed") throw new ProviderError("parameters", data?.status === "failed" ? "Azure no completó el video. Revisa el trabajo en tu recurso; no se reenvió." : "Azure devolvió un estado de video no reconocido; no se reenvió.");
  // Only the configured Azure origin receives the key. Ignore any output URL in the response.
  const response = await call(azureVideoUrl(credentials, id, true), init, key);
  const mime = response.headers.get("content-type")?.split(";")[0];
  if (mime && !["video/mp4", "application/octet-stream"].includes(mime)) throw new ProviderError("parameters", "Azure no devolvió video MP4.");
  const limit = 100 * 1024 * 1024;
  if (Number(response.headers.get("content-length") ?? 0) > limit || !response.body) throw new ProviderError("parameters", "Video vacío o superior al límite de esta operación.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new ProviderError("parameters", "El video supera 100 MiB."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (length < 12 || new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp") throw new ProviderError("parameters", "Azure devolvió un archivo que no es MP4 válido.");
  return { kind: "files", files: [{ bytes, mime: "video/mp4", name: `azure-${id}.mp4` }] };
}