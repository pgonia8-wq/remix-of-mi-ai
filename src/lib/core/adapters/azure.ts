// Azure OpenAI adapter. Chat keeps the existing, user-verified path. Images use the same URL contract:
// /openai/v1 → deployment in the body; legacy resource URL → deployment in the route + api-version.
import { ProviderError } from "../../providers";
import { call, requireKey } from "./http";
import { visionBody, parseVision } from "./vision";
import { embeddingBody, embeddingInputs, parseEmbeddings } from "./embeddings";
import { OPENAI_VOICES, parseSpeech, parseTranscript, speechBody, transcriptionForm } from "./audio";
import { derivedEdit, chatViaLegacy, editForm, imageBody, parseImages } from "./openai";
import { sync, trimSlash, type AdapterCredentials, type ProviderAdapter } from "./types";

export function azureUrl(c: AdapterCredentials, deployment: string, op: "images/generations" | "images/edits" | "chat/completions" | "audio/speech" | "audio/transcriptions" | "audio/translations" | "embeddings"): { url: string; v1: boolean } {
  let u: URL;
  try { u = new URL(trimSlash(c.endpoint?.trim() ?? "")); } catch { throw new ProviderError("endpoint", "URL de Azure incorrecta."); }
  if (u.protocol !== "https:") throw new ProviderError("endpoint", "URL de Azure incorrecta: usa HTTPS.");
  const path = trimSlash(u.pathname);
  if (path.startsWith("/openai/v1")) return { url: `${u.origin}/openai/v1/${op}`, v1: true };
  if (path === "" || path === "/openai" || /^\/openai\/deployments\//.test(path)) {
    if (!c.apiVersion?.trim()) throw new ProviderError("parameters", "Versión de API requerida para la URL clásica de Azure.");
    return { url: `${u.origin}/openai/deployments/${encodeURIComponent(deployment)}/${op}?api-version=${encodeURIComponent(c.apiVersion.trim())}`, v1: false };
  }
  throw new ProviderError("endpoint", "URL de Azure incorrecta: usa la URL del recurso o /openai/v1.");
}

export const azureAdapter: ProviderAdapter = {
  id: "azure_openai",
  label: "Azure OpenAI",
  operations: { chat: sync(), vision: sync(), "image.generate": sync(), "image.edit": sync(), "image.upscale": sync(), "image.remove_bg": sync(), "audio.tts": sync(), "audio.transcribe": sync(), "audio.translate": sync(), embedding: sync() },
  async listVoices() { return OPENAI_VOICES.map((v) => ({ id: v, name: v })); },
  supports(cap) { return cap in this.operations; },
  async run(c, r) {
    const key = requireKey(c.apiKey);
    if (r.capability === "image.upscale" || r.capability === "image.remove_bg") return azureAdapter.run(c, derivedEdit(r));
    if (r.capability === "chat") return chatViaLegacy({ ...c, deployment: r.model || c.deployment }, r);
    const deployment = r.model || c.deployment || "";
    if (!deployment.trim()) throw new ProviderError("model", "Deployment inexistente: indica el deployment de imágenes.");
    if (r.capability === "audio.tts") {
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
  // Azure exposes deployments only through management APIs (not the API key) → manual registration.
};
