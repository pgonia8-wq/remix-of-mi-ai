// OpenAI adapter: chat (existing streaming path, unchanged), images and audio.
import { streamChat, ProviderError } from "../../providers";
import { call, requireKey } from "./http";
import { visionBody, parseVision } from "./vision";
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
  for (const file of r.files ?? []) f.append("image[]", new Blob([file.bytes as BlobPart], { type: file.mime }), file.name);
  if (r.params?.["size"]) f.append("size", String(r.params["size"]));
  return f;
}

const base = (c: AdapterCredentials) => trimSlash(c.endpoint?.trim() || "https://api.openai.com/v1");

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  operations: { chat: sync(), vision: sync(), "image.generate": sync(), "image.edit": sync(), "audio.tts": sync(), "audio.transcribe": sync() },
  supports(cap) { return cap in this.operations; },
  async run(c, r) {
    const key = requireKey(c.apiKey);
    const auth = { authorization: `Bearer ${key}` };
    switch (r.capability) {
      case "chat": return chatViaLegacy(c, r);
      case "vision": {
        const res = await call(`${base(c)}/chat/completions`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(visionBody(r, true)), signal: r.signal ?? null }, key);
        return { kind: "text", text: parseVision(await res.json()) };
      }
      case "image.generate": {
        const res = await call(`${base(c)}/images/generations`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(imageBody(r)), signal: r.signal ?? null }, key);
        return { kind: "files", files: parseImages(await res.json(), String(r.params?.["output_format"] ?? "png")) };
      }
      case "image.edit": {
        if (!r.files?.length) throw new ProviderError("parameters", "Editar imagen requiere al menos una imagen de entrada.");
        const res = await call(`${base(c)}/images/edits`, { method: "POST", headers: auth, body: editForm(r, true), signal: r.signal ?? null }, key);
        return { kind: "files", files: parseImages(await res.json(), "png") };
      }
      case "audio.tts": {
        const res = await call(`${base(c)}/audio/speech`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ model: r.model, input: r.prompt ?? "", voice: r.params?.["voice"] ?? "alloy", response_format: "mp3" }), signal: r.signal ?? null }, key);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length < 100) throw new ProviderError("parameters", "Respuesta inválida: audio vacío.", 200);
        return { kind: "files", files: [{ bytes, mime: "audio/mpeg", name: "voz.mp3" }] };
      }
      case "audio.transcribe": {
        const file = r.files?.[0];
        if (!file) throw new ProviderError("parameters", "Transcribir requiere un archivo de audio.");
        const f = new FormData();
        f.append("model", r.model);
        f.append("file", new Blob([file.bytes as BlobPart], { type: file.mime }), file.name);
        const res = await call(`${base(c)}/audio/transcriptions`, { method: "POST", headers: auth, body: f, signal: r.signal ?? null }, key);
        const d = await res.json();
        if (typeof d?.text !== "string") throw new ProviderError("parameters", "Respuesta inválida: sin transcripción.", 200);
        return { kind: "text", text: d.text };
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
