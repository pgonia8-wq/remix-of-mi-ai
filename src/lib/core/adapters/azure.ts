// Azure OpenAI adapter. Chat keeps the existing, user-verified path. Images use the same URL contract:
// /openai/v1 → deployment in the body; legacy resource URL → deployment in the route + api-version.
import { ProviderError } from "../../providers";
import { call, requireKey } from "./http";
import { visionBody, parseVision } from "./vision";
import { embeddingBody, embeddingInputs, parseEmbeddings } from "./embeddings";
import { OPENAI_VOICES, parseSpeech, parseTranscript, speechBody, transcriptionForm } from "./audio";
import { derivedEdit, chatViaLegacy, editForm, imageBody, parseImages } from "./openai";
import { b64ToBytes, sync, trimSlash, type AdapterCredentials, type ProviderAdapter, type RunRequest, type RunResult } from "./types";
import { azureKindOf, parseAzureUrl } from "../../azure-url";
import { toolCallBody, parseToolCalls } from "./tool-calls";
import { azureVideoSupport, runAzureVideo, pollAzureVideo } from "./azure-video";
import { runCosmos } from "./cosmos";

export function azureUrl(c: AdapterCredentials, deployment: string, op: "images/generations" | "images/edits" | "chat/completions" | "audio/speech" | "audio/transcriptions" | "audio/translations" | "embeddings"): { url: string; v1: boolean } {
  const raw = trimSlash(c.endpoint?.trim() ?? "");
  try { if (new URL(raw).protocol === "http:") throw new ProviderError("endpoint", "URL de Azure incorrecta: usa HTTPS."); } catch (e) { if (e instanceof ProviderError) throw e; throw new ProviderError("endpoint", "URL de Azure incorrecta."); }
  // Any URL copied from the portal (resource, /openai/v1/…, /openai/deployments/<x>/<operation>?api-version=…) works.
  const a = parseAzureUrl(raw);
  if (!a) throw new ProviderError("endpoint", "URL de Azure incorrecta: usa la URL del recurso, /openai/v1 o la URL completa del deployment.");
  if (a.v1) return { url: `${a.endpoint}/${op}`, v1: true };
  const version = c.apiVersion?.trim() || a.apiVersion;
  if (!version) throw new ProviderError("parameters", "Versión de API requerida para la URL clásica de Azure.");
  return { url: `${a.endpoint}/openai/deployments/${encodeURIComponent(deployment)}/${op}?api-version=${encodeURIComponent(version)}`, v1: false };
}

/** gpt-audio deployments speak only through chat completions with audio output (they have no /audio/speech route). */
async function speakViaAudioChat(c: AdapterCredentials, key: string, deployment: string, r: RunRequest): Promise<RunResult> {
  const text = (r.prompt ?? "").trim();
  if (!text) throw new ProviderError("parameters", "Escribe el texto que quieres convertir en voz.");
  const { url, v1 } = azureUrl(c, deployment, "chat/completions");
  const voice = String(r.params?.["voice"] || "alloy");
  const body = { ...(v1 ? { model: deployment } : {}), modalities: ["text", "audio"], audio: { voice, format: "wav" },
    messages: [{ role: "system", content: "Lee en voz alta exactamente el texto del usuario, sin añadir nada." }, { role: "user", content: text }] };
  const res = await call(url, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body: JSON.stringify(body), signal: r.signal ?? null }, key);
  const d = await res.json().catch(() => null);
  const data = d?.choices?.[0]?.message?.audio?.data;
  if (typeof data !== "string" || data.length < 100) throw new ProviderError("parameters", "Respuesta inválida: el modelo no devolvió audio.", 200);
  return { kind: "files", files: [{ bytes: b64ToBytes(data), mime: "audio/wav", name: "voz.wav" }], ...(typeof d.choices[0].message.audio.transcript === "string" ? { text: d.choices[0].message.audio.transcript } : {}) };
}

export const azureAdapter: ProviderAdapter = {
  id: "azure_openai",
  label: "Azure OpenAI",
  operations: { chat: sync(), "chat.tools": sync(), vision: sync(), "image.generate": sync(), "image.edit": sync(), "image.upscale": sync(), "image.remove_bg": sync(), "audio.tts": sync(), "audio.transcribe": sync(), "audio.translate": sync(), embedding: sync(), "video.generate": azureVideoSupport },
  async listVoices() { return OPENAI_VOICES.map((v) => ({ id: v, name: v })); },
  supports(cap) { return cap in this.operations; },
  async run(c, r) {
    // NVIDIA Cosmos on managed compute: its own endpoint and contract (videos and images).
    if (azureKindOf({ deployment: r.model || c.deployment, extraParams: c.extraParams }) === "cosmos") return runCosmos(c, r);
    if (r.capability === "video.generate") return runAzureVideo(c, r);
    const key = requireKey(c.apiKey);
    if (r.capability === "image.upscale" || r.capability === "image.remove_bg") return azureAdapter.run(c, derivedEdit(r));
    if (r.capability === "chat") return chatViaLegacy({ ...c, deployment: r.model || c.deployment }, r);
    const deployment = r.model || c.deployment || "";
    if (!deployment.trim()) throw new ProviderError("model", "Deployment inexistente: indica el deployment de imágenes.");
    if (r.capability === "audio.tts") {
      if (azureKindOf({ deployment, extraParams: c.extraParams }) === "audio-chat") return speakViaAudioChat(c, key, deployment, r);
      const { url, v1 } = azureUrl(c, deployment, "audio/speech");
      return parseSpeech(await call(url, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body: JSON.stringify(speechBody({ ...r, model: deployment }, v1)), signal: r.signal ?? null }, key));
    }
    if (r.capability === "audio.transcribe" || r.capability === "audio.translate") {
      const tr = r.capability === "audio.translate";
      const { url, v1 } = azureUrl(c, deployment, tr ? "audio/translations" : "audio/transcriptions");
      return parseTranscript(await call(url, { method: "POST", headers: { "api-key": key }, body: transcriptionForm({ ...r, model: deployment }, v1, tr), signal: r.signal ?? null }, key), !!r.params?.["allowEmpty"]);
    }
    if (r.capability === "embedding") {
      const { url, v1 } = azureUrl(c, deployment, "embeddings");
      return parseEmbeddings(await (await call(url, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body: JSON.stringify(embeddingBody({ ...r, model: deployment }, v1)), signal: r.signal ?? null }, key)).json(), embeddingInputs(r).length);
    }
    if (r.capability === "chat.tools") {
      const { url, v1 } = azureUrl(c, deployment, "chat/completions");
      const res = await call(url, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body: JSON.stringify(toolCallBody({ ...r, model: deployment }, v1)), signal: r.signal ?? null }, key);
      return { kind: "text", text: parseToolCalls(await res.json()) };
    }
    if (r.capability === "vision") {
      const { url, v1 } = azureUrl(c, deployment, "chat/completions");
      const res = await call(url, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body: JSON.stringify(visionBody({ ...r, model: deployment }, v1)), signal: r.signal ?? null }, key);
      return { kind: "text", text: parseVision(await res.json()) };
    }
    if (r.capability === "image.generate") {
      const { url, v1 } = azureUrl(c, deployment, "images/generations");
      const body = imageBody({ ...r, model: deployment });
      if (!v1) delete body["model"];
      const res = await call(url, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body: JSON.stringify(body), signal: r.signal ?? null }, key);
      return { kind: "files", files: parseImages(await res.json(), "png") };
    }
    if (r.capability === "image.edit") {
      if (!r.files?.length) throw new ProviderError("parameters", "Editar imagen requiere al menos una imagen de entrada.");
      const { url, v1 } = azureUrl(c, deployment, "images/edits");
      const res = await call(url, { method: "POST", headers: { "api-key": key }, body: editForm({ ...r, model: deployment }, v1), signal: r.signal ?? null }, key);
      return { kind: "files", files: parseImages(await res.json(), "png") };
    }
    throw new ProviderError("parameters", `Azure OpenAI no implementa «${r.capability}» en este adaptador.`);
  },
  poll: pollAzureVideo,
  // Azure exposes deployments only through management APIs (not the API key) → manual registration.
};
