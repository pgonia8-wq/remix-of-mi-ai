// Shared Azure OpenAI URL handling. People paste whatever the Azure portal shows:
// resource URL, /openai/v1, /openai/v1/responses, /openai/v1/chat/completions,
// /openai/deployments/<name>/<operation>?api-version=…, /openai/responses?api-version=…,
// or the realtime wss:// URL. All of them collapse to one of the two API contracts:
//   v1     → https://host/openai/v1   (deployment goes in the body as "model")
//   legacy → https://host             (deployment in the route + api-version)

export type AzureOp = "chat" | "responses" | "tts" | "transcribe" | "translate" | "embeddings" | "images" | "realtime" | "videos";
export type AzureUrl = { endpoint: string; v1: boolean; deployment?: string; apiVersion?: string; op?: AzureOp };

const OPS: [RegExp, AzureOp][] = [
  [/^chat\/completions$/, "chat"], [/^responses$/, "responses"], [/^audio\/speech$/, "tts"],
  [/^audio\/transcriptions$/, "transcribe"], [/^audio\/translations$/, "translate"], [/^embeddings$/, "embeddings"],
  [/^images\/(generations|edits)$/, "images"], [/^realtime(\/.*)?$/, "realtime"], [/^videos(\/.*)?$/, "videos"],
  [/^completions$/, "chat"],
];
const opOf = (rest: string): AzureOp | undefined => OPS.find(([re]) => re.test(rest))?.[1];

/** Returns null when the text is not an Azure-style URL this app understands (no credentials, https/wss only). */
export function parseAzureUrl(raw: string | null | undefined): AzureUrl | null {
  let u: URL;
  try { u = new URL((raw ?? "").trim()); } catch { return null; }
  if (!["https:", "wss:"].includes(u.protocol) || u.username || u.password) return null;
  const origin = `https://${u.host}`;
  const path = u.pathname.replace(/\/+$/, "");
  const q = (k: string) => u.searchParams.get(k)?.trim() || undefined;
  const apiVersion = q("api-version");
  const extra = (o: AzureUrl): AzureUrl => ({ ...o, ...(apiVersion && !o.v1 ? { apiVersion } : {}) });
  if (path === "" || path === "/openai") return extra({ endpoint: origin, v1: false });
  if (path === "/openai/v1" || path.startsWith("/openai/v1/")) {
    const rest = path.slice("/openai/v1".length).replace(/^\//, "");
    const op = rest ? opOf(rest) : undefined;
    if (rest && !op) return null;
    const deployment = q("model") ?? q("deployment");
    return { endpoint: `${origin}/openai/v1`, v1: true, ...(op ? { op } : {}), ...(deployment ? { deployment } : {}) };
  }
  const dep = /^\/openai\/deployments\/([^/]+)(?:\/(.+))?$/.exec(path);
  if (dep) {
    const op = dep[2] ? opOf(dep[2]) : undefined;
    if (dep[2] && !op) return null;
    return extra({ endpoint: origin, v1: false, deployment: decodeURIComponent(dep[1]!), ...(op ? { op } : {}) });
  }
  const legacy = /^\/openai\/(.+)$/.exec(path);
  if (legacy) {
    const op = opOf(legacy[1]!);
    if (!op) return null;
    const deployment = q("model") ?? q("deployment");
    return extra({ endpoint: origin, v1: false, op, ...(deployment ? { deployment } : {}) });
  }
  return null;
}

/** What a deployment does, from the URL operation (when pasted) or its name. Drives the connection test and default capability. */
export type AzureDeploymentKind = "chat" | "realtime" | "tts" | "transcribe" | "audio-chat" | "embedding" | "image";
export function azureDeploymentKind(name: string | null | undefined, op?: AzureOp): AzureDeploymentKind {
  const n = (name ?? "").toLowerCase();
  if (op === "realtime" || /realtime/.test(n)) return "realtime";
  if (op === "tts" || /(^|[-_.])tts([-_.]|$)/.test(n)) return "tts";
  if (op === "transcribe" || op === "translate" || /whisper|transcribe/.test(n)) return "transcribe";
  if (op === "embeddings" || /embedding/.test(n)) return "embedding";
  if (op === "images" || /dall-?e|gpt-image|image-/.test(n)) return "image";
  if (/(^|[-_])audio([-_.]|$)|audio-preview/.test(n)) return "audio-chat";
  return "chat";
}
/** Default registry capability for a deployment kind. */
export const AZURE_KIND_CAPABILITY: Record<AzureDeploymentKind, string> = {
  chat: "chat", realtime: "speech.realtime", tts: "audio.tts", transcribe: "audio.transcribe",
  "audio-chat": "audio.tts", embedding: "embedding", image: "image.generate",
};
export const AZURE_KIND_LABEL: Record<AzureDeploymentKind, string> = {
  chat: "", realtime: "Modelo de voz en tiempo real: se prueba abriendo una sesión de voz real y se usará en Conversación por voz, no en el chat de texto.",
  tts: "Modelo de texto a voz: se prueba generando un audio corto real y se usará en Texto a voz, no en el chat de texto.",
  transcribe: "Modelo de transcripción: se prueba enviando un audio corto real y se usará para transcribir, no en el chat de texto.",
  "audio-chat": "Modelo de audio (gpt-audio): se prueba pidiéndole una respuesta hablada real y se usará en Texto a voz, no en el chat de texto.",
  embedding: "Modelo de embeddings: se prueba generando un vector real y se usará para búsquedas en tus documentos.",
  image: "Modelo de imágenes: no se genera una imagen de prueba para no cobrarte; se comprueba que la URL, la clave y el deployment existen.",
};

const KINDS = new Set<AzureDeploymentKind>(["chat", "realtime", "tts", "transcribe", "audio-chat", "embedding", "image"]);
/** Azure OpenAI rows store the chosen kind as {"miai_kind": …} in extra_params (never sent to Azure); otherwise it is inferred from the name. */
export function azureKindOf(p: { deployment?: string | null; extraParams?: string | null }): AzureDeploymentKind {
  try { const k = JSON.parse(p.extraParams || "{}")?.miai_kind; if (KINDS.has(k)) return k; } catch { /* inferred below */ }
  return azureDeploymentKind(p.deployment);
}
export const azureKindParams = (kind: AzureDeploymentKind) => JSON.stringify({ miai_kind: kind });
