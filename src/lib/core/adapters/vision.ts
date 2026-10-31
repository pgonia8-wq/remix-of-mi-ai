// Vision (image → text) through the OpenAI-style chat/completions contract, used by OpenAI and Azure OpenAI.
import { ProviderError } from "../../providers";
import type { RunRequest } from "./types";

export const VISION_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const VISION_MAX_BYTES = 20_000_000;

function toDataUrl(bytes: Uint8Array, mime: string) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
}

export function visionBody(r: RunRequest, withModel: boolean) {
  const files = r.files ?? [];
  if (!files.length) throw new ProviderError("parameters", "Analizar imagen requiere al menos una imagen.");
  for (const f of files) {
    if (!VISION_MIME.includes(f.mime)) throw new ProviderError("parameters", `Formato no admitido para visión: ${f.mime}. Usa PNG, JPEG, WEBP o GIF.`);
    if (f.bytes.length > VISION_MAX_BYTES) throw new ProviderError("parameters", "Imagen demasiado grande para analizar (máximo 20 MB).");
  }
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: [
      { type: "text", text: r.prompt?.trim() || "Describe esta imagen con detalle." },
      ...files.map((f) => ({ type: "image_url", image_url: { url: toDataUrl(f.bytes, f.mime), detail: (r.params?.["detail"] as string) ?? "auto" } })),
    ] }],
    max_completion_tokens: Number(r.params?.["maxTokens"] ?? 1200),
  };
  if (withModel) body["model"] = r.model;
  return body;
}

export function parseVision(d: any): string {
  const c = d?.choices?.[0]?.message?.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? "").join("") : "";
  if (!text.trim()) throw new ProviderError("parameters", "Respuesta inválida: el modelo no devolvió una descripción.", 200);
  return text;
}

/** 32×32 solid-blue PNG used for minimal real vision tests (expected answer: azul). */
export const TEST_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGOQi7pDU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAPcdUEyCpjHdAAAAAElFTkSuQmCC";
