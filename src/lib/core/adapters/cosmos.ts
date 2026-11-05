// NVIDIA Cosmos (NIM "Generator") on Azure Foundry managed compute or any HTTPS NIM.
// Contract: POST <base>/v1/infer, synchronous JSON → { b64_image } (JPEG) or { b64_video } (MP4).
// https://docs.nvidia.com/nim/cosmos/latest/api-reference.html
import { ProviderError, responseError } from "../../providers";
import { cosmosBase, isAzureResourceHost } from "../../azure-url";
import { call, requireKey } from "./http";
import { b64ToBytes, type AdapterCredentials, type RunRequest, type RunResult } from "./types";

export const COSMOS_RESOURCE_HINT = "Este modelo (NVIDIA Cosmos) está desplegado en cómputo administrado y no responde en la URL del recurso de Azure OpenAI. En Foundry abre Deployments → tu deployment de Cosmos, copia el «URI de destino» (Target URI) y su clave, y pégalos aquí con el tipo «Video e imágenes (NVIDIA Cosmos)».";

export function cosmosInferUrl(endpoint: string | null | undefined): string {
  try { if (isAzureResourceHost(new URL((endpoint ?? "").trim()).hostname)) throw new ProviderError("endpoint", COSMOS_RESOURCE_HINT); }
  catch (e) { if (e instanceof ProviderError) throw e; }
  const base = cosmosBase(endpoint);
  if (!base) throw new ProviderError("endpoint", "URL de Cosmos incorrecta: usa el URI de destino HTTPS del deployment (sin usuario ni contraseña en la URL).");
  return `${base}/v1/infer`;
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
}

const int = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

/** Request body with only fields the strict NIM schema knows (unknown fields are rejected by the service). */
export function cosmosBody(r: RunRequest): Record<string, unknown> {
  if (r.capability !== "image.generate" && r.capability !== "video.generate") throw new ProviderError("parameters", `NVIDIA Cosmos se usa para crear videos e imágenes, no para «${r.capability}».`);
  const prompt = r.prompt?.trim() ?? "";
  const file = r.files?.[0];
  const mime = file?.mime.split(";")[0]?.trim().toLowerCase() ?? "";
  let mode: string;
  if (r.capability === "image.generate") {
    if (file) throw new ProviderError("parameters", "Cosmos crea imágenes solo desde texto; para animar una imagen pide un video.");
    mode = "text2image";
  } else mode = !file ? "text2video" : mime.startsWith("image/") ? "image2video" : mime.startsWith("video/") ? "video2video" : "";
  if (!mode) throw new ProviderError("parameters", "Cosmos acepta como referencia una imagen o un video.");
  if (!prompt && mode.startsWith("text2")) throw new ProviderError("parameters", r.capability === "image.generate" ? "Describe la imagen." : "Describe el video.");
  if (file && mode === "image2video" && file.bytes.length > 14_000_000) throw new ProviderError("parameters", "La imagen de referencia es demasiado grande para Cosmos (máx. ~14 MB).");
  if (file && mode === "video2video" && file.bytes.length > 75 * 1024 * 1024) throw new ProviderError("parameters", "El video de referencia supera 75 MB.");
  const p = r.params ?? {};
  const body: Record<string, unknown> = { model_mode: mode, ...(prompt ? { prompt: prompt.slice(0, 20_000) } : {}) };
  if (file) body["input_reference"] = toDataUrl(file.bytes, mime);
  const negative = typeof p["negative_prompt"] === "string" ? p["negative_prompt"].trim() : "";
  if (negative) body["negative_prompt"] = negative.slice(0, 20_000);
  const seed = int(p["seed"], 0, 2 ** 31 - 1); if (seed !== undefined) body["seed"] = seed;
  const steps = int(p["num_inference_steps"], 1, 100); if (steps !== undefined) body["num_inference_steps"] = steps;
  const guidance = num(p["guidance_scale"], 1, 7); if (guidance !== undefined) body["guidance_scale"] = guidance;
  const fps = num(p["fps"], 1, 60); if (fps !== undefined && r.capability === "video.generate") body["fps"] = fps;
  return body;
}

/** On Android the request goes through native HTTP (managed endpoints don't send CORS headers to the WebView). */
async function postJson(url: string, key: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<any> {
  const headers = { authorization: `Bearer ${key}`, "api-key": key, "content-type": "application/json", accept: "application/json" };
  let native = false;
  try { const { Capacitor } = await import("@capacitor/core"); native = Capacitor.isNativePlatform(); } catch { native = false; }
  if (native) {
    const { CapacitorHttp } = await import("@capacitor/core");
    let res;
    try { res = await CapacitorHttp.request({ url, method: "POST", headers, data: body, connectTimeout: 30_000, readTimeout: timeoutMs, responseType: "json" }); }
    catch { throw new ProviderError("network", "Error de red: no se pudo alcanzar el endpoint de Cosmos o tardó demasiado."); }
    const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
    if (res.status >= 400) throw responseError(res.status, text, key);
    try { return typeof res.data === "string" ? JSON.parse(res.data) : res.data; } catch { throw new ProviderError("parameters", "Cosmos devolvió una respuesta que no es JSON.", res.status); }
  }
  const res = await call(url, { method: "POST", headers, body: JSON.stringify(body), credentials: "omit", redirect: "error", signal: signal ?? null }, key, timeoutMs);
  return res.json().catch(() => { throw new ProviderError("parameters", "Cosmos devolvió una respuesta que no es JSON.", res.status); });
}

export async function runCosmos(c: AdapterCredentials, r: RunRequest): Promise<RunResult> {
  const url = cosmosInferUrl(c.endpoint);
  const key = requireKey(c.apiKey);
  const body = cosmosBody(r);
  const video = r.capability === "video.generate";
  const d = await postJson(url, key, body, video ? 15 * 60_000 : 5 * 60_000, r.signal);
  if (video) {
    if (typeof d?.b64_video !== "string" || d.b64_video.length < 100) throw new ProviderError("parameters", "Respuesta inválida: Cosmos no devolvió un video.", 200);
    const bytes = b64ToBytes(d.b64_video);
    if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp") throw new ProviderError("parameters", "Cosmos devolvió un archivo que no es MP4 válido.", 200);
    return { kind: "files", files: [{ bytes, mime: "video/mp4", name: "cosmos.mp4" }] };
  }
  if (typeof d?.b64_image !== "string" || d.b64_image.length < 100) throw new ProviderError("parameters", "Respuesta inválida: Cosmos no devolvió una imagen.", 200);
  return { kind: "files", files: [{ bytes: b64ToBytes(d.b64_image), mime: "image/jpeg", name: "cosmos.jpg" }] };
}
