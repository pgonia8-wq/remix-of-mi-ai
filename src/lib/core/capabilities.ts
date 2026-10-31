// Capabilities are data, not schema. New ones are inserted as rows; the DB structure never changes.
export type ParamSpec = { type: "string" | "number" | "boolean" | "enum"; values?: string[]; min?: number; max?: number; default?: unknown };

export type CapabilitySpec = {
  id: string;
  label: string;
  inputs: string[]; // modalities: text, image, audio, video, document, embedding
  outputs: string[];
  mimeIn: string[];
  mimeOut: string[];
  formats: string[];
  params: Record<string, ParamSpec>;
  limits: Record<string, number>;
  restrictions: string[];
  maxInputBytes: number | null;
  async: boolean;
  cancel: boolean;
  poll: boolean;
  recover: boolean;
  auth: "api_key" | "none" | "oauth";
};

const base = (id: string, label: string, inputs: string[], outputs: string[], o: Partial<CapabilitySpec> = {}): CapabilitySpec => ({
  id, label, inputs, outputs, mimeIn: [], mimeOut: [], formats: [], params: {}, limits: {}, restrictions: [],
  maxInputBytes: null, async: false, cancel: false, poll: false, recover: false, auth: "api_key", ...o,
});

export const INITIAL_CAPABILITIES: CapabilitySpec[] = [
  base("chat", "Chat", ["text"], ["text"], { params: { temperature: { type: "number", min: 0, max: 2 } } }),
  base("reasoning", "Razonamiento", ["text"], ["text"]),
  base("vision", "Visión", ["text", "image"], ["text"], { mimeIn: ["image/png", "image/jpeg", "image/webp"], maxInputBytes: 20_000_000 }),
  base("research.web", "Buscar en internet", ["text"], ["text"], { restrictions: ["Cita siempre las fuentes"] }),
  base("document.create", "Crear documento", ["text"], ["document"]),
  base("document.analyze", "Análisis de documentos", ["document", "text"], ["text"], { mimeIn: ["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"] }),
  base("image.generate", "Generar imagen", ["text"], ["image"], {
    mimeOut: ["image/png", "image/jpeg", "image/webp"], formats: ["png", "jpeg", "webp"],
    params: { size: { type: "enum", values: ["1024x1024", "1024x1536", "1536x1024", "auto"], default: "1024x1024" }, quality: { type: "enum", values: ["low", "medium", "high", "auto"], default: "auto" }, n: { type: "number", min: 1, max: 4, default: 1 } },
  }),
  base("image.edit", "Editar imagen", ["text", "image"], ["image"], { mimeIn: ["image/png", "image/jpeg", "image/webp"], mimeOut: ["image/png"], maxInputBytes: 25_000_000 }),
  base("image.upscale", "Mejorar resolución (IA)", ["image"], ["image"], { mimeIn: ["image/png", "image/jpeg", "image/webp"], mimeOut: ["image/png"], maxInputBytes: 25_000_000 }),
  base("image.remove_bg", "Eliminar fondo (IA)", ["image"], ["image"], { mimeIn: ["image/png", "image/jpeg", "image/webp"], mimeOut: ["image/png"], maxInputBytes: 25_000_000 }),
  base("video.generate", "Generar video", ["text", "image"], ["video"], { mimeOut: ["video/mp4"], async: true, poll: true, recover: true, cancel: true }),
  base("video.edit", "Editar video", ["video", "text"], ["video"], { async: true, poll: true, recover: true }),
  base("video.extend", "Extender video", ["video"], ["video"], { async: true, poll: true, recover: true }),
  base("audio.tts", "Texto a voz", ["text"], ["audio"], { mimeOut: ["audio/mpeg"], formats: ["mp3"], params: { voice: { type: "string" } }, limits: { maxChars: 4096 } }),
  base("audio.transcribe", "Transcribir audio", ["audio"], ["text"], { mimeIn: ["audio/mpeg", "audio/wav", "audio/webm", "audio/mp4", "audio/ogg"], maxInputBytes: 25_000_000 }),
  base("audio.translate", "Traducir audio al inglés", ["audio"], ["text"], { mimeIn: ["audio/mpeg", "audio/wav", "audio/webm", "audio/mp4", "audio/ogg"], maxInputBytes: 25_000_000 }),
  base("audio.voice_clone", "Clonar voz", ["audio"], ["voice"], { mimeIn: ["audio/mpeg", "audio/wav", "audio/webm", "audio/mp4", "audio/ogg"], maxInputBytes: 25_000_000, restrictions: ["Solo con consentimiento explícito de la persona dueña de la voz"] }),
  base("audio.enhance", "Mejorar audio", ["audio"], ["audio"], { async: true, poll: true }),
  base("music.generate", "Generar música", ["text"], ["audio"], { async: true, poll: true, recover: true, restrictions: ["Respeta licencias y derechos de autor"] }),
  base("speech.realtime", "Voz en tiempo real", ["audio"], ["audio", "text"]),
  base("embedding", "Embeddings", ["text"], ["embedding"]),
  base("rerank", "Reordenar resultados", ["text"], ["text"]),
  base("moderation", "Moderación", ["text", "image"], ["text"]),
  base("code.generate", "Generar código", ["text"], ["text"]),
  base("code.execute", "Ejecutar código", ["text"], ["text"], { restrictions: ["Requiere entorno aislado"] }),
];

export function validateCapability(c: CapabilitySpec): string[] {
  const errs: string[] = [];
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/.test(c.id)) errs.push("id inválido");
  if (!c.inputs.length || !c.outputs.length) errs.push("entradas y salidas requeridas");
  if (c.recover && !c.async) errs.push("recover solo aplica a operaciones asíncronas");
  return errs;
}
