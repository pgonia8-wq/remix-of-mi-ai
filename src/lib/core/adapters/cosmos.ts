// NVIDIA Cosmos (NIM "Generator") on Azure Foundry managed compute or any HTTPS NIM.
// Contract: POST <base>/v1/infer, synchronous JSON → { b64_image } (JPEG) or { b64_video } (MP4).
// https://docs.nvidia.com/nim/cosmos/latest/api-reference.html
import { ProviderError, redactSecret, responseError } from "../../providers";
import { cosmosBase, isAzureResourceHost, parseAzureUrl } from "../../azure-url";
import { downloadMedia } from "./media-output";
import { call, requireKey } from "./http";
import { b64ToBytes, type AdapterCredentials, type RunRequest, type RunResult } from "./types";


export function cosmosInferUrl(endpoint: string | null | undefined): string {
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
async function postJson(url: string, key: string, body: unknown, timeoutMs: number, signal?: AbortSignal, auth: "both" | "api-key" | "bearer" = "both"): Promise<any> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", ...(auth !== "api-key" ? { authorization: `Bearer ${key}` } : {}), ...(auth !== "bearer" ? { "api-key": key } : {}) };
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

const onResourceHost = (endpoint: string | null | undefined) => { try { return isAzureResourceHost(new URL((endpoint ?? "").trim()).hostname); } catch { return false; } };

/** Foundry resource route: https://<res>.services.ai.azure.com/openai/v1/chat/completions with the deployment as "model". */
export function cosmosChatUrl(endpoint: string | null | undefined): string {
  const a = parseAzureUrl(endpoint);
  if (!a) throw new ProviderError("endpoint", "URL de Azure incorrecta para Cosmos: pega la URL …/openai/v1/chat/completions de tu recurso.");
  return `${a.endpoint.replace(/\/openai\/v1$/, "")}/openai/v1/chat/completions`;
}

/** POST JSON to the resource; on "azure-resource-enc" retry with the key as Bearer (Foundry partner models). */
async function postAzureChat(url: string, key: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<any> {
  try { return await postJson(url, key, body, timeoutMs, signal, "api-key"); }
  catch (e) {
    if (!(e instanceof ProviderError) || !/azure-resource-enc/i.test(e.technical ?? "")) throw e;
    return postJson(url, key, body, timeoutMs, signal, "bearer");
  }
}

/** Finds generated media in a chat answer: data URLs, b64 fields or https links to mp4/images. */
export function mediaFromChat(d: any): { b64?: string; url?: string; mime: string } | null {
  const text = JSON.stringify(d ?? {});
  const data = /data:(video\/mp4|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]{100,})/.exec(text);
  if (data) return { b64: data[2]!, mime: data[1]! };
  const find = (o: any): any => { if (!o || typeof o !== "object") return null; for (const [k, v] of Object.entries(o)) { if ((k === "b64_video" || k === "b64_image" || k === "b64_json") && typeof v === "string" && v.length > 100) return { k, v }; const r = find(v); if (r) return r; } return null; };
  const b = find(d);
  if (b) return { b64: b.v, mime: b.k === "b64_video" ? "video/mp4" : "image/jpeg" };
  const link = /https:\/\/[^\s"'<>()]+?\.(mp4|png|jpe?g|webp)(\?[^\s"'<>()]*)?/i.exec(text.replace(/\\\//g, "/"));
  if (link) return { url: link[0], mime: link[1]!.toLowerCase() === "mp4" ? "video/mp4" : link[1]!.toLowerCase() === "png" ? "image/png" : link[1]!.toLowerCase() === "webp" ? "image/webp" : "image/jpeg" };
  return null;
}

/** Content may be a string, typed blocks, or a provider-specific object. Never coerce objects to strings. */
export function cosmosResponseText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(cosmosResponseText).filter(Boolean).join("\n");
  if (!content || typeof content !== "object") return "";
  const block = content as Record<string, unknown>;
  if (typeof block["text"] === "string") return block["text"];
  if (block["text"] && typeof block["text"] === "object") return cosmosResponseText(block["text"]);
  if (typeof block["value"] === "string") return block["value"];
  if (block["content"] !== undefined) return cosmosResponseText(block["content"]);
  return "";
}

/** Connection probe through the resource: any real answer from the deployment counts. */
export async function probeCosmosChat(c: AdapterCredentials, deployment: string, signal?: AbortSignal): Promise<void> {
  const key = requireKey(c.apiKey);
  const d = await postAzureChat(cosmosChatUrl(c.endpoint), key, { model: deployment, messages: [{ role: "user", content: "Responde solo: OK" }], stream: false }, 120_000, signal);
  if (!d?.choices?.length && !mediaFromChat(d)) throw new ProviderError("parameters", "Respuesta inválida: el deployment no devolvió una respuesta.", 200);
}

async function runCosmosViaChat(c: AdapterCredentials, r: RunRequest): Promise<RunResult> {
  const key = requireKey(c.apiKey);
  const deployment = (r.model || c.deployment || "").trim();
  if (!deployment) throw new ProviderError("model", "Indica el deployment de Cosmos.");
  const video = r.capability === "video.generate";
  if (r.capability !== "image.generate" && !video) throw new ProviderError("parameters", `NVIDIA Cosmos se usa para crear videos e imágenes, no para «${r.capability}».`);
  const prompt = r.prompt?.trim();
  if (!prompt) throw new ProviderError("parameters", video ? "Describe el video." : "Describe la imagen.");
  const file = r.files?.find((f) => f.mime.startsWith("image/"));
  const content = file ? [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: toDataUrl(file.bytes, file.mime) } }] : prompt;
  const d = await postAzureChat(cosmosChatUrl(c.endpoint), key, { model: deployment, messages: [{ role: "system", content: video ? "Generate a video for the user's description." : "Generate an image for the user's description." }, { role: "user", content }], stream: false, ...(video ? { modalities: ["video"] } : { modalities: ["image"] }) }, video ? 15 * 60_000 : 5 * 60_000, r.signal);
  const media = mediaFromChat(d);
  if (!media || (video && media.mime !== "video/mp4") || (!video && !media.mime.startsWith("image/"))) {
    const said = redactSecret(cosmosResponseText(d?.choices?.[0]?.message?.content), key).slice(0, 300);
    const technical = redactSecret(JSON.stringify(d ?? {}), key).slice(0, 2000);
    throw new ProviderError("parameters", `Cosmos respondió pero no entregó ${video ? "un video" : "una imagen"} por esta ruta. No se creó ningún archivo. Que el modelo responda por chat no verifica su capacidad de generación; revisa la operación de generación admitida por ese deployment en Foundry.${said ? ` Respuesta: ${said}` : " La respuesta estructurada está en Detalle técnico."}`, 200, technical);
  }
  const bytes = media.b64 ? b64ToBytes(media.b64) : await downloadMedia(media.url!, media.mime);
  if (video && new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp") throw new ProviderError("parameters", "Cosmos devolvió un archivo que no es MP4 válido.", 200);
  return { kind: "files", files: [{ bytes, mime: media.mime, name: video ? "cosmos.mp4" : `cosmos.${media.mime.split("/")[1]}` }] };
}

export async function runCosmos(c: AdapterCredentials, r: RunRequest): Promise<RunResult> {
  if (onResourceHost(c.endpoint)) return runCosmosViaChat(c, r);
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
