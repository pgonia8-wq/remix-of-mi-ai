// Shared OpenAI-style audio contract (/audio/speech, /audio/transcriptions, /audio/translations), used by OpenAI and Azure OpenAI.
import { ProviderError } from "../../providers";
import type { RunRequest, RunResult } from "./types";

export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];
export const AUDIO_IN_MIME = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/ogg"];
export const AUDIO_MAX_BYTES = 25_000_000;
export const TTS_MAX_CHARS = 4096;

export function speechBody(r: RunRequest, withModel: boolean) {
  const text = (r.prompt ?? "").trim();
  if (!text) throw new ProviderError("parameters", "Escribe el texto que quieres convertir en voz.");
  if (text.length > TTS_MAX_CHARS) throw new ProviderError("parameters", `Texto demasiado largo para voz (máximo ${TTS_MAX_CHARS} caracteres).`);
  const b: Record<string, unknown> = { input: text, voice: String(r.params?.["voice"] || "alloy"), response_format: "mp3" };
  if (r.params?.["speed"]) b["speed"] = Math.min(4, Math.max(0.25, Number(r.params["speed"])));
  if (r.params?.["instructions"]) b["instructions"] = String(r.params["instructions"]);
  if (withModel) b["model"] = r.model;
  return b;
}

export function audioInput(r: RunRequest) {
  const f = r.files?.[0];
  if (!f) throw new ProviderError("parameters", "Esta operación requiere un archivo de audio.");
  const mime = f.mime.split(";")[0]!;
  if (!AUDIO_IN_MIME.includes(mime)) throw new ProviderError("parameters", `Formato de audio no admitido: ${mime}. Usa MP3, WAV, M4A, WEBM u OGG.`);
  if (f.bytes.length > AUDIO_MAX_BYTES) throw new ProviderError("parameters", "Audio demasiado grande (máximo 25 MB).");
  return { ...f, mime };
}

export function transcriptionForm(r: RunRequest, withModel: boolean, translate = false) {
  const f = audioInput(r);
  const form = new FormData();
  if (withModel) form.append("model", r.model);
  form.append("file", new Blob([f.bytes as BlobPart], { type: f.mime }), f.name);
  if (!translate && r.params?.["language"]) form.append("language", String(r.params["language"]));
  if (r.prompt?.trim()) form.append("prompt", r.prompt.trim());
  form.append("response_format", "json");
  return form;
}

export async function parseSpeech(res: Response): Promise<RunResult> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 100) throw new ProviderError("parameters", "Respuesta inválida: audio vacío.", 200);
  return { kind: "files", files: [{ bytes, mime: "audio/mpeg", name: "voz.mp3" }] };
}

export async function parseTranscript(res: Response, allowEmpty = false): Promise<RunResult> {
  const d = await res.json().catch(() => null);
  if (typeof d?.text !== "string") throw new ProviderError("parameters", "Respuesta inválida: sin transcripción.", 200);
  if (!d.text.trim() && !allowEmpty) throw new ProviderError("parameters", "No se detectó voz en el audio.", 200);
  return { kind: "text", text: d.text };
}

/** ~0.6 s silent-ish WAV tone generated in code, used for minimal real transcription tests. */
export function testWav(): Uint8Array {
  const rate = 16000, n = Math.round(rate * 0.6), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 3000), true);
  return new Uint8Array(buf);
}
