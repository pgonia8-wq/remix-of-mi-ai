import type { ProviderKind } from "./db/repo";

export const PROVIDER_KINDS: { kind: ProviderKind; label: string; endpoint: string; model: string; needsDeployment?: boolean; needsVersion?: boolean }[] = [
  { kind: "openai", label: "OpenAI", endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { kind: "anthropic", label: "Anthropic", endpoint: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-latest" },
  { kind: "gemini", label: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-1.5-flash" },
  { kind: "azure", label: "Azure AI Foundry", endpoint: "https://TU-RECURSO.openai.azure.com", model: "gpt-4o", needsDeployment: true, needsVersion: true },
  { kind: "azure_openai", label: "Azure OpenAI", endpoint: "", model: "", needsDeployment: true, needsVersion: true },
  { kind: "xai", label: "xAI", endpoint: "https://api.x.ai/v1", model: "grok-2-latest" },
  { kind: "deepseek", label: "DeepSeek", endpoint: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { kind: "mistral", label: "Mistral", endpoint: "https://api.mistral.ai/v1", model: "mistral-large-latest" },
  { kind: "cohere", label: "Cohere", endpoint: "https://api.cohere.com/v2", model: "command-r-plus" },
  { kind: "openai_compatible", label: "Compatible OpenAI", endpoint: "http://localhost:11434/v1", model: "llama3.1" },
  { kind: "custom", label: "Endpoint personalizado", endpoint: "https://", model: "modelo" },
];

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string; images?: { mime: string; data: string }[] };
export type ProviderCall = {
  kind: ProviderKind;
  endpoint: string | null;
  apiKey: string | null;
  model: string;
  deployment?: string | null;
  apiVersion?: string | null;
  extraParams?: string | null;
};

function extra(p: ProviderCall): Record<string, unknown> {
  if (!p.extraParams?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(p.extraParams);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const values = parsed as Record<string, unknown>;
    for (const field of ["model", "stream", "messages", "contents", "system", "systemInstruction"]) {
      if (field in values) throw new Error();
    }
    return values;
  } catch {
    throw new ProviderError("parameters", "Parámetros incompatibles: usa un objeto JSON sin sustituir modelo, mensajes ni streaming.");
  }
}
const trim = (s: string) => s.replace(/\/+$/, "");

function buildRequest(p: ProviderCall, messages: ChatMsg[]): { url: string; init: RequestInit; parse: (data: any) => string | null } {
  const hasImages = messages.some((m) => m.images?.length);
  if (hasImages && !["openai", "azure", "azure_openai", "anthropic", "gemini", "xai", "mistral", "openai_compatible", "custom"].includes(p.kind)) throw new ProviderError("parameters", "Este adaptador no admite imágenes en el chat. Elige un modelo con visión.");
  const openaiMessages = messages.map((m) => ({ role: m.role, content: m.images?.length ? [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }))] : m.content }));
  const defaults = PROVIDER_KINDS.find((k) => k.kind === p.kind);
  if (!defaults) throw new ProviderError("endpoint", "Endpoint incorrecto: proveedor desconocido.");
  const azure = p.kind === "azure" || p.kind === "azure_openai";
  const ep = trim(p.endpoint?.trim() || defaults.endpoint);
  let endpoint: URL;
  try {
    endpoint = new URL(ep);
    if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new Error();
    if ([...endpoint.searchParams.keys()].some(key => !azure || key !== "api-version")) throw new Error();
  } catch {
    throw new ProviderError("endpoint", "Endpoint incorrecto: utiliza una URL HTTP o HTTPS sin credenciales ni parámetros.");
  }
  const azurePath = trim(endpoint.pathname);
  const azureV1 = azure && (azurePath === "/openai/v1" || azurePath === "/openai/v1/chat/completions");
  if ((!azure && !p.model.trim()) || (azure && !p.deployment?.trim())) throw new ProviderError("model", "Modelo o deployment inexistente: completa el identificador.");
  if (p.kind === "azure_openai" && !azureV1 && !p.apiVersion?.trim()) throw new ProviderError("parameters", "Versión de API requerida: introduce la versión de Azure OpenAI.");
  if (!["custom", "openai_compatible"].includes(p.kind) && !p.apiKey?.trim()) throw new ProviderError("key", "API Key inválida: falta la credencial.");
  const key = p.apiKey ?? "";
  const x = p.kind === "azure_openai" ? {} : extra(p);
  if (p.kind === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    return {
      url: `${ep}/messages`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": p.apiVersion || "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: p.model, max_tokens: 4096, stream: true, system: system || undefined, messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.images?.length ? [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } }))] : m.content })), ...x }),
      },
      parse: (d) => (d.type === "content_block_delta" ? d.delta?.text ?? null : null),
    };
  }
  if (p.kind === "gemini") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    return {
      url: `${ep}/models/${encodeURIComponent(p.model)}:streamGenerateContent?alt=sse`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }, ...(m.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }))] })),
          ...x,
        }),
      },
      parse: (d) => d.candidates?.[0]?.content?.parts?.map((x: any) => x.text ?? "").join("") ?? null,
    };
  }
  if (p.kind === "cohere") {
    return {
      url: `${ep}/chat`,
      init: { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model: p.model, stream: true, messages, ...x }) },
      parse: (d) => (d.type === "content-delta" ? d.delta?.message?.content?.text ?? null : null),
    };
  }
  // OpenAI-style: openai, azure, xai, deepseek, mistral, compatible, custom
  let url = `${ep}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (azure) {
    // Accept a resource URL or a copied deployment chat-completions URL.
    // Explicit form fields remain authoritative; never duplicate the route.
    const path = azurePath;
    let base: string;
    if (azureV1) {
      // Azure v1 selects deployment through model, not through the URL.
      // Dated api-version is not part of this GA endpoint contract.
      url = `${endpoint.origin}/openai/v1/chat/completions`;
    } else {
    if (path === "" || path === "/openai") base = endpoint.origin;
    else if (/^\/openai\/deployments\/[^/]+\/chat\/completions$/.test(path)) base = endpoint.origin;
    else throw new ProviderError("endpoint", "URL de Azure incorrecta: usa la URL del recurso, /openai/v1/chat/completions o la URL completa del deployment.");
    url = `${base}/openai/deployments/${encodeURIComponent(p.deployment?.trim() || p.model)}/chat/completions?api-version=${encodeURIComponent(p.apiVersion?.trim() || "2024-10-21")}`;
    }
    headers["api-key"] = key;
  } else if (key) headers["authorization"] = `Bearer ${key}`;
  return {
    url,
    init: { method: "POST", headers, body: JSON.stringify({ ...(azureV1 ? { model: p.deployment?.trim() } : azure ? {} : { model: p.model }), stream: true, messages: openaiMessages, ...x }) },
    parse: (d) => d.choices?.[0]?.delta?.content ?? null,
  };
}

/** MI AI imposes no message quota. A provider 429 (rate limit) is retried a bounded number of times, honoring its wait hint. */
export const RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 60_000;
export function rateLimitWaitMs(res: Response, body: string, attempt: number): number {
  const header = res.headers.get("retry-after-ms") ?? null;
  if (header && Number.isFinite(Number(header))) return Number(header);
  const ra = res.headers.get("retry-after");
  if (ra && Number.isFinite(Number(ra))) return Number(ra) * 1000;
  const m = /retry after (\d+(?:\.\d+)?)\s*(second|sec|s|millisecond|ms)/i.exec(body);
  if (m) return Number(m[1]) * (/^m/i.test(m[2]!) ? 1 : 1000);
  return 2000 * 2 ** attempt;
}
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
  const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); };
  signal?.addEventListener("abort", onAbort, { once: true });
});

/** Streams text deltas. API key is only placed in request headers — never logged. */
export async function streamChat(p: ProviderCall, messages: ChatMsg[], onDelta: (t: string) => void, signal?: AbortSignal) {
  const { url, init, parse } = buildRequest(p, messages);
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, { ...init, signal: signal ?? null });
    if (res.ok && res.body) break;
    const body = await res.text().catch(() => "");
    if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const wait = rateLimitWaitMs(res, body, attempt);
      if (wait <= MAX_RATE_LIMIT_WAIT_MS) { await sleep(Math.max(0, wait), signal); continue; }
    }
    throw responseError(res.status, body, p.apiKey);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { throw new ProviderError("parameters", "Respuesta inválida: el proveedor no devolvió JSON válido."); }
    if (parsed.error || parsed.type === "error") throw responseError(res.status, JSON.stringify(parsed.error ?? parsed), p.apiKey);
    const text = parse(parsed);
    if (typeof text === "string" && text) onDelta(text);
  };
  try { for (;;) {
    const { done, value } = await reader.read();
    if (done) { buf += dec.decode(); if (buf.trim()) consume(buf.trim()); break; }
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      consume(line);
    }
  } } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export type DiagnosticCode = "key" | "auth" | "endpoint" | "model" | "unavailable" | "network" | "timeout" | "parameters";
export type ConnectionResult = { ok: true; checkedAt: number } | { ok: false; code: DiagnosticCode; message: string; httpStatus?: number; technical?: string };
export class ProviderError extends Error {
  constructor(public code: DiagnosticCode, message: string, public httpStatus?: number, public technical?: string) { super(message); this.name = "ProviderError"; }
}
export function redactSecret(text: string, key?: string | null): string {
  let safe = text;
  if (key) for (const variant of [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)]) safe = safe.split(variant).join("[credencial oculta]");
  return safe.replace(/(?:Bearer\s+|sk-|AIza)[\w.\-]+/gi, "[credencial oculta]").slice(0, 600);
}
export function responseError(status: number, body: string, key?: string | null): ProviderError {
  const technical = redactSecret(body, key);
  const msg = technical.toLowerCase();
  let code: DiagnosticCode = "parameters";
  if (/invalid.{0,20}(api.?key|key)|api.?key.{0,20}(invalid|incorrect)|api_key_invalid/.test(msg)) code = "key";
  else if (status === 401 || status === 403 || /authentication|unauthorized|permission.denied/.test(msg)) code = "auth";
  else if (/model.*(not.found|does.not.exist|not.exist)|deploymentnotfound|deployment.*not.found|model_not_found/.test(msg)) code = "model";
  else if (status === 408 || status === 504) code = "timeout";
  else if (status === 429 || status >= 500 || /overloaded|capacity|unavailable|quota|resource_exhausted/.test(msg)) code = "unavailable";
  else if (status === 404 || status === 405) code = "endpoint";
  const labels: Record<DiagnosticCode, string> = { key: "API Key inválida.", auth: "Error de autenticación: revisa credenciales y permisos.", endpoint: "Endpoint incorrecto: revisa la dirección y la ruta del proveedor.", model: "Modelo o deployment inexistente.", unavailable: "Modelo sin disponibilidad: revisa cuota, límites o estado del servicio.", network: "Error de red.", timeout: "Error de red o timeout: el proveedor no respondió a tiempo.", parameters: "Parámetros incompatibles o respuesta inválida." };
  if (status === 429) {
    let reason = "";
    try { const j = JSON.parse(technical); reason = String(j?.error?.message ?? j?.message ?? ""); } catch { reason = technical; }
    reason = reason.replace(/\s+/g, " ").trim().slice(0, 220);
    const label = "El proveedor rechazó la solicitud por su propio límite de velocidad o cuota (HTTP 429). MI AI no limita los mensajes; se reintentó automáticamente. Si sigue pasando, aumenta los tokens por minuto del deployment en tu cuenta del proveedor o espera un momento."
      + (reason ? ` Detalle del proveedor: ${reason}` : "");
    return new ProviderError("unavailable", label, status, technical);
  }
  return new ProviderError(code, labels[code], status, technical);
}
/** Realtime deployments are voice-only: they never answer chat completions. */
export const isRealtimeDeployment = (name: string | null | undefined) => /realtime/i.test(name ?? "");
/**
 * Accepts the Azure "wss://…/openai/v1/realtime?model=…" URL copied from the portal.
 * Returns the HTTPS resource URL (/openai/v1) and the deployment named in ?model= / ?deployment=.
 * Returns null for anything that is not a realtime URL; insecure ws:// is rejected.
 */
export function parseRealtimeUrl(raw: string): { endpoint: string; deployment: string } | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const path = u.pathname.replace(/\/+$/, "");
  if (!["wss:", "https:"].includes(u.protocol) || !/\/realtime$/.test(path)) return null;
  if (u.username || u.password) return null;
  return { endpoint: `https://${u.host}/openai/v1`, deployment: (u.searchParams.get("model") ?? u.searchParams.get("deployment") ?? "").trim() };
}
/** Verifies a realtime deployment by minting a real short-lived session token with the user's key. */
async function testRealtime(p: ProviderCall, signal: AbortSignal): Promise<void> {
  const deployment = p.deployment?.trim();
  if (!deployment) throw new ProviderError("model", "Modelo o deployment inexistente: completa el deployment de voz.");
  if (!p.apiKey?.trim()) throw new ProviderError("key", "API Key inválida: falta la credencial.");
  const { realtimeEndpoints, realtimeConfig } = await import("./realtime-voice");
  const ep = realtimeEndpoints(p.kind === "openai" ? "openai" : "azure_openai", p.endpoint);
  const headers: Record<string, string> = { "content-type": "application/json", ...(ep.auth === "bearer" ? { authorization: `Bearer ${p.apiKey}` } : { "api-key": p.apiKey }) };
  const res = await fetch(ep.secrets, { method: "POST", headers, body: JSON.stringify({ session: realtimeConfig(deployment, "Prueba de conexión de MI AI.", "alloy") }), signal });
  const body = await res.text().catch(() => "");
  if (!res.ok) throw responseError(res.status, body, p.apiKey);
  let token: any = null;
  try { token = JSON.parse(body); } catch { /* invalid below */ }
  const value = typeof token?.value === "string" ? token.value : typeof token?.client_secret?.value === "string" ? token.client_secret.value : null;
  if (!value) throw new ProviderError("parameters", "Respuesta inválida: Azure no devolvió una sesión de voz válida.", res.status);
}
/** Draft credentials stay only in memory. Success requires actual generated model text. */
export async function testProvider(p: ProviderCall, timeoutMs = 20000): Promise<ConnectionResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ProviderError("timeout", "Error de red o timeout: se agotó el tiempo de espera.")); }, timeoutMs); });
  try {
    if (p.kind === "azure_openai" && isRealtimeDeployment(p.deployment)) {
      await Promise.race([testRealtime(p, controller.signal), timeout]);
      return { ok: true, checkedAt: Date.now() };
    }
    let out = "";
    await Promise.race([streamChat(p, [{ role: "user", content: "Responde solo: OK" }], (t) => { out += t; }, controller.signal), timeout]);
    if (!out.trim()) throw new ProviderError("parameters", "Respuesta inválida: no se recibió texto generado por el modelo.", 200);
    return { ok: true, checkedAt: Date.now() };
  } catch (e) {
    if (controller.signal.aborted) return { ok: false, code: "timeout", message: "Error de red o timeout: se agotó el tiempo de espera." };
    if (e instanceof ProviderError) return { ok: false, code: e.code, message: redactSecret(e.message, p.apiKey), ...(e.httpStatus !== undefined ? { httpStatus: e.httpStatus } : {}), ...(e.technical ? { technical: redactSecret(e.technical, p.apiKey) } : {}) };
    return { ok: false, code: "network", message: p.kind === "azure_openai" || p.kind === "azure" ? "No se pudo alcanzar Azure desde este entorno. Revisa Internet y la URL; la vista previa puede bloquear la solicitud por CORS o por restricciones de red del recurso. Sin respuesta HTTP no se puede confirmar si la clave o el deployment son válidos." : "Error de red: no se pudo alcanzar el endpoint. Revisa Internet, DNS, TLS y permisos de acceso del navegador (CORS)." };
  } finally { clearTimeout(timer); }
}

export function canSaveModel(current: ProviderCall, tested: ProviderCall | null, result: ConnectionResult | null): boolean {
  return result?.ok === true && tested !== null && JSON.stringify(current) === JSON.stringify(tested);
}
