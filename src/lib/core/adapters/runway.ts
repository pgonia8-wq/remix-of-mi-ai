import { ProviderError } from "../../providers";
import { call, requireKey } from "./http";
import { downloadMedia } from "./media-output";
import type { InputFile, ProviderAdapter, RunRequest } from "./types";

const base = "https://api.dev.runwayml.com/v1";
const headers = (key: string) => ({ authorization: `Bearer ${key}`, "X-Runway-Version": "2024-11-06", "content-type": "application/json" });
function remoteUrl(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ProviderError("parameters", "Identificador remoto inválido.");
  return `${base}/tasks/${encodeURIComponent(id)}`;
}
function dataUri(file: InputFile) {
  if (file.bytes.length > 20_000_000) throw new ProviderError("parameters", "La referencia supera 20 MB.");
  let str = ""; for (let i = 0; i < file.bytes.length; i += 0x8000) str += String.fromCharCode(...file.bytes.subarray(i, i + 0x8000));
  return `data:${file.mime};base64,${btoa(str)}`;
}
export function runwayBody(r: RunRequest) {
  const prompt = r.prompt?.trim();
  if (!prompt || prompt.length > 1000) throw new ProviderError("parameters", "Describe el video en 1–1000 caracteres.");
  const file = r.files?.[0];
  if (r.capability === "video.edit") {
    if (!file?.mime.startsWith("video/")) throw new ProviderError("parameters", "Editar requiere un video de entrada.");
    return { route: "video_to_video", body: { model: r.model, videoUri: dataUri(file), promptText: prompt } };
  }
  const duration = Number(r.params?.["seconds"] ?? 5), ratio = String(r.params?.["ratio"] ?? "1280:720");
  if (!Number.isInteger(duration) || duration < 2 || duration > 10) throw new ProviderError("parameters", "La duración debe estar entre 2 y 10 segundos; algunos modelos admiten solo 4, 6 u 8.");
  if (!["1280:720", "720:1280"].includes(ratio)) throw new ProviderError("parameters", "Elige formato horizontal o vertical.");
  if (file && !["image/png", "image/jpeg", "image/webp"].includes(file.mime)) throw new ProviderError("parameters", "La referencia debe ser PNG, JPEG o WebP.");
  return { route: file ? "image_to_video" : "text_to_video", body: { model: r.model, promptText: prompt, duration, ratio, ...(file ? { promptImage: dataUri(file) } : {}) } };
}
const asyncOp = { async: true, poll: true, recover: true, cancel: true, idempotencyHeader: null };
export const runwayAdapter: ProviderAdapter = {
  id: "runway", label: "Runway", operations: { "video.generate": asyncOp, "video.edit": asyncOp },
  supports(cap) { return cap in this.operations; },
  async run(c, r) {
    if (!this.supports(r.capability)) throw new ProviderError("parameters", "Operación no implementada por Runway.");
    const key = requireKey(c.apiKey), request = runwayBody(r);
    const data = await (await call(`${base}/${request.route}`, { method: "POST", headers: headers(key), body: JSON.stringify(request.body), signal: r.signal ?? null }, key)).json();
    if (typeof data?.id !== "string") throw new ProviderError("parameters", "Runway no confirmó el identificador del trabajo.");
    remoteUrl(data.id);
    return { kind: "remote", remoteId: data.id };
  },
  async poll(c, id) {
    const key = requireKey(c.apiKey);
    const data = await (await call(remoteUrl(id), { headers: headers(key) }, key, 30_000)).json();
    if (["PENDING", "THROTTLED", "RUNNING"].includes(data?.status)) return { kind: "pending", progress: Math.max(0, Math.min(1, Number(data.progress ?? 0))) };
    if (data?.status !== "SUCCEEDED") throw new ProviderError("parameters", "Runway no completó el trabajo; revisa su estado en el proveedor.");
    const url = data?.output?.[0];
    if (typeof url !== "string") throw new ProviderError("parameters", "Runway no devolvió un archivo de video.");
    return { kind: "files", files: [{ bytes: await downloadMedia(url, "video/mp4"), mime: "video/mp4", name: "video.mp4" }] };
  },
  async cancel(c, id) { const key = requireKey(c.apiKey); await call(remoteUrl(id), { method: "DELETE", headers: headers(key) }, key, 30_000); },
};