// OpenAI adapter: chat (existing streaming path, unchanged), images and audio.
import { streamChat, ProviderError } from "../../providers";
import { call, requireKey } from "./http";
import { visionBody, parseVision } from "./vision";
import { embeddingBody, embeddingInputs, parseEmbeddings } from "./embeddings";
import { OPENAI_VOICES, parseSpeech, parseTranscript, speechBody, transcriptionForm } from "./audio";
import { b64ToBytes, sync, trimSlash, type AdapterCredentials, type ProviderAdapter, type RunRequest, type RunResult } from "./types";

export async function chatViaLegacy(c: AdapterCredentials, r: RunRequest): Promise<RunResult> {
  let text = "";
  await streamChat({ kind: c.kind, endpoint: c.endpoint, apiKey: c.apiKey, model: r.model, deployment: c.deployment, apiVersion: c.apiVersion, extraParams: c.extraParams },
    [{ role: "user", content: r.prompt ?? "" }], (t) => { text += t; }, r.signal);
  if (!text.trim()) throw new ProviderError("parameters", "Respuesta inválida: el modelo no devolvió texto.");
  return { kind: "text", text };
}

export function parseImages(data: any, fmt: string): { bytes: Uint8Array; mime: string; name: string }[] {
  const items = Array.isArray(data?.data) ? data.data : [];
  const files = items.filter((d: any) => typeof d?.b64_json === "string").map((d: any, i: number) => ({ bytes: b64ToBytes(d.b64_json), mime: `image/${fmt === "jpeg" ? "jpeg" : fmt}`, name: `imagen-${i + 1}.${fmt === "jpeg" ? "jpg" : fmt}` }));
  if (!files.length) throw new ProviderError("parameters", "Respuesta inválida: el proveedor no devolvió ninguna imagen.", 200);
  return files;
}

export function imageBody(r: RunRequest) {
  const p = r.params ?? {};
  const body: Record<string, unknown> = { model: r.model, prompt: r.prompt ?? "", n: Number(p["n"] ?? 1), size: p["size"] ?? "1024x1024" };
  if (p["quality"]) body["quality"] = p["quality"];
  if (/^dall-e/i.test(r.model)) body["response_format"] = "b64_json"; // gpt-image models always return b64_json
  else if (p["output_format"]) body["output_format"] = p["output_format"];
  return body;
}

export function editForm(r: RunRequest, withModel: boolean) {
  const f = new FormData();
  if (withModel) f.append("model", r.model);
  f.append("prompt", r.prompt ?? "");
  // A file named "mask.png" is the inpainting mask (transparent = area to repaint), sent in the API's mask field.
  for (const file of r.files ?? []) f.append(file.name === "mask.png" ? "mask" : "image[]", new Blob([file.bytes as BlobPart], { type: file.mime }), file.name);
  if (r.params?.["size"]) f.append("size", String(r.params["size"]));
  if (r.params?.["background"]) f.append("background", String(r.params["background"]));
  if (r.params?.["output_format"]) f.append("output_format", String(r.params["output_format"]));
  if (r.params?.["quality"]) f.append("quality", String(r.params["quality"]));
  return f;
}

/**
 * AI background removal and resolution enhancement for any model on the OpenAI-style images/edits contract.
 * Works with whichever model the user marks with these capabilities; the instruction keeps the subject unchanged.
 */
export function derivedEdit(r: RunRequest): RunRequest {
  if (!r.files?.length) throw new ProviderError("parameters", "Esta operación requiere una imagen de entrada.");
  const gptImage = /gpt-image/i.test(r.model);
  if (r.capability === "image.remove_bg") {
    return { ...r, capability: "image.edit", prompt: r.prompt?.trim() || "Remove the background completely. Keep the main subject exactly as it is, with clean precise edges and its original colors. Transparent background.",
      params: { ...r.params, ...(gptImage ? { background: "transparent", output_format: "png" } : {}) } };
  }
  return { ...r, capability: "image.edit", prompt: r.prompt?.trim() || "Upscale and enhance this exact image: increase sharpness, fine detail and clarity, reduce noise and compression artifacts. Do not change composition, subjects, colors, text or style.",
    params: { ...r.params, ...(gptImage ? { quality: "high" } : {}) } };
}

const base = (c: AdapterCredentials) => trimSlash(c.endpoint?.trim() || "https://api.openai.com/v1");

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  operations: { chat: sync(), vision: sync(), "image.generate": sync(), "image.edit": sync(), "image.upscale": sync(), "image.remove_bg": sync(), "audio.tts": sync(), "audio.transcribe": sync(), "audio.translate": sync(), embedding: sync() },
  async listVoices() { return OPENAI_VOICES.map((v) => ({ id: v, name: v })); },
  supports(cap) { return cap in this.operations; },
  async run(c, r) {
    const key = requireKey(c.apiKey);
    const auth = { authorization: `Bearer ${key}` };
    switch (r.capability) {
      case "chat": return chatViaLegacy(c, r);
      case "embedding": {
        const res = await call(`${base(c)}/embeddings`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(embeddingBody(r, true)), signal: r.signal ?? null }, key);
        return parseEmbeddings(await res.json(), embeddingInputs(r).length);
      }
      case "vision": {
        const res = await call(`${base(c)}/chat/completions`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(visionBody(r, true)), signal: r.signal ?? null }, key);
        return { kind: "text", text: parseVision(await res.json()) };
      }
      case "image.generate": {
        const res = await call(`${base(c)}/images/generations`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(imageBody(r)), signal: r.signal ?? null }, key);
        return { kind: "files", files: parseImages(await res.json(), String(r.params?.["output_format"] ?? "png")) };
      }
      case "image.upscale":
      case "image.remove_bg": return openaiAdapter.run(c, derivedEdit(r));
      case "image.edit": {
        if (!r.files?.length) throw new ProviderError("parameters", "Editar imagen requiere al menos una imagen de entrada.");
        const res = await call(`${base(c)}/images/edits`, { method: "POST", headers: auth, body: editForm(r, true), signal: r.signal ?? null }, key);
        return { kind: "files", files: parseImages(await res.json(), "png") };
      }
      case "audio.tts": {
        const res = await call(`${base(c)}/audio/speech`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(speechBody(r, true)), signal: r.signal ?? null }, key);
        return parseSpeech(res);
      }
      case "audio.transcribe":
      case "audio.translate": {
        const tr = r.capability === "audio.translate";
        const res = await call(`${base(c)}/audio/${tr ? "translations" : "transcriptions"}`, { method: "POST", headers: auth, body: transcriptionForm(r, true, tr), signal: r.signal ?? null }, key);
        return parseTranscript(res, !!r.params?.["allowEmpty"]);
      }
    }
    throw new ProviderError("parameters", `OpenAI no implementa «${r.capability}» en este adaptador.`);
  },
  async listModels(c) {
    const key = requireKey(c.apiKey);
    const res = await call(`${base(c)}/models`, { headers: { authorization: `Bearer ${key}` } }, key, 20_000);
    const d = await res.json();
    return (d?.data ?? []).map((m: any) => String(m.id)).filter(Boolean);
  },
};
