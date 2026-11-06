import type { ProviderKind } from "./db/repo";
import { azureKindOf, isAzureResourceHost, parseAzureUrl, type AzureDeploymentKind } from "./azure-url";

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

export type ToolCall = { id: string; name: string; arguments: string };
export type ChatMsg = { role: "system" | "user" | "assistant" | "tool"; content: string; images?: { mime: string; data: string }[]; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string };
/** Providers whose chat endpoint follows the OpenAI tool-calling contract (tools + streamed delta.tool_calls). */
export const CHAT_TOOL_KINDS: ProviderKind[] = ["openai", "azure", "azure_openai", "xai", "deepseek", "mistral", "openai_compatible", "custom"];
export const supportsChatTools = (kind: ProviderKind) => CHAT_TOOL_KINDS.includes(kind);
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

function buildRequest(p: ProviderCall, messages: ChatMsg[], tools?: unknown[]): { url: string; init: RequestInit; parse: (data: any) => string | null } {
  const hasImages = messages.some((m) => m.images?.length);
  if (hasImages && !["openai", "azure", "azure_openai", "anthropic", "gemini", "xai", "mistral", "openai_compatible", "custom"].includes(p.kind)) throw new ProviderError("parameters", "Este adaptador no admite imágenes en el chat. Elige un modelo con visión.");
  // Tool-call turns exist only for OpenAI-style providers; other contracts never receive them.
  if (!supportsChatTools(p.kind)) messages = messages.filter((m) => m.role !== "tool" && !m.tool_calls?.length);
  // DeepSeek/Kimi thinking models require their reasoning back on assistant turns when tools are sent; OpenAI/Azure never return it.
  const keepsReasoning = !["openai", "azure", "azure_openai"].includes(p.kind);
  const openaiMessages = messages.map((m) => {
    const base: Record<string, unknown> = m.role === "tool" ? { role: "tool", tool_call_id: m.tool_call_id, content: m.content }
      : m.tool_calls?.length ? { role: "assistant", content: m.content || null, tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }
      : { role: m.role, content: m.images?.length ? [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }))] : m.content };
    if (keepsReasoning && m.role === "assistant" && m.reasoning_content) base["reasoning_content"] = m.reasoning_content;
    return base;
  });
  const toolBody = tools?.length && supportsChatTools(p.kind) ? { tools, tool_choice: "auto" } : {};
  const defaults = PROVIDER_KINDS.find((k) => k.kind === p.kind);
  if (!defaults) throw new ProviderError("endpoint", "Endpoint incorrecto: proveedor desconocido.");
  const azure = p.kind === "azure" || p.kind === "azure_openai";
  let ep = trim(p.endpoint?.trim() || defaults.endpoint);
  // Azure: any URL copied from the portal collapses to the resource (classic) or /openai/v1 (GA) contract.
  const az = azure ? parseAzureUrl(ep) : null;
  if (azure && !az) {
    if (/^https:\/\//i.test(ep)) throw new ProviderError("endpoint", "URL de Azure incorrecta: usa la URL del recurso, /openai/v1 o la URL completa del deployment (por ejemplo …/openai/deployments/NOMBRE/chat/completions).");
  }
  if (az) { ep = az.endpoint; if (!az.v1 && !p.apiVersion?.trim() && az.apiVersion) p = { ...p, apiVersion: az.apiVersion }; }
  let endpoint: URL;
  try {
    endpoint = new URL(ep);
    if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new Error();
    if ([...endpoint.searchParams.keys()].some(key => !azure || key !== "api-version")) throw new Error();
  } catch {
    throw new ProviderError("endpoint", "Endpoint incorrecto: utiliza una URL HTTP o HTTPS sin credenciales ni parámetros.");
  }
  const azurePath = trim(endpoint.pathname);
  const azureV1 = azure && azurePath === "/openai/v1";
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
    if (azureV1) {
      // Azure v1 selects deployment through model, not through the URL.
      // Dated api-version is not part of this GA endpoint contract.
      url = `${endpoint.origin}/openai/v1/chat/completions`;
    } else {
    url = `${endpoint.origin}/openai/deployments/${encodeURIComponent(p.deployment?.trim() || p.model)}/chat/completions?api-version=${encodeURIComponent(p.apiVersion?.trim() || "2024-10-21")}`;
    }
    headers["api-key"] = key;
  } else if (key) headers["authorization"] = `Bearer ${key}`;
  return {
    url,
    init: { method: "POST", headers, body: JSON.stringify({ ...(azureV1 ? { model: p.deployment?.trim() } : azure ? {} : { model: p.model }), stream: true, messages: openaiMessages, ...toolBody, ...x }) },
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

/** Families that also expose the OpenAI Responses API. Newer models (for example GPT-6) only accept function tools there. */
const RESPONSES_KINDS: ProviderKind[] = ["openai", "azure", "azure_openai"];
const responsesKey = (p: ProviderCall) => `${p.kind}|${(p.endpoint ?? "").trim()}|${(p.deployment || p.model || "").trim()}`;
/** Providers that rejected tools on chat/completions this session go straight to /responses (no wasted request per turn). */
const responsesForTools = new Set<string>();
/** A chat/completions 400 caused by function tools (not by anything else) on a Responses-capable family. */
export const isToolRejection = (status: number | undefined, technical: string | undefined) =>
  status === 400 && !isContentBlock(technical ?? "") && /tool|function/i.test(technical ?? "");

export function isContentBlock(body: string): boolean {
  return /content_filter|content_policy_violation|responsibleaipolicyviolation|"(?:stop_reason|finish_reason)"\s*:\s*"refusal"|"type"\s*:\s*"refusal"/i.test(body);
}

/** Same endpoint/credentials as chat/completions, routed to the Responses API with native function tools. */
export function buildResponsesRequest(p: ProviderCall, messages: ChatMsg[], tools: unknown[]): { url: string; init: RequestInit } {
  const base = buildRequest(p, messages.filter((m) => m.role !== "tool" && !m.tool_calls?.length)); // validates URL, model and key
  const azure = p.kind === "azure" || p.kind === "azure_openai";
  const u = new URL(base.url);
  let url: string; let model: string;
  if (!azure) { url = base.url.replace(/\/chat\/completions$/, "/responses"); model = p.model; }
  else if (u.pathname === "/openai/v1/chat/completions") { url = `${u.origin}/openai/v1/responses`; model = p.deployment!.trim(); }
  else {
    const v = (p.apiVersion ?? "").trim();
    url = `${u.origin}/openai/responses?api-version=${encodeURIComponent(v >= "2025-03-01" ? v : "2025-04-01-preview")}`;
    model = p.deployment!.trim();
  }
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === "tool") { input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content }); continue; }
    if (m.tool_calls?.length) {
      if (m.content) input.push({ role: "assistant", content: m.content });
      for (const c of m.tool_calls) input.push({ type: "function_call", call_id: c.id, name: c.name, arguments: c.arguments || "{}" });
      continue;
    }
    if (m.role === "user" && m.images?.length) input.push({ role: "user", content: [{ type: "input_text", text: m.content }, ...m.images.map((i) => ({ type: "input_image", image_url: `data:${i.mime};base64,${i.data}` }))] });
    else input.push({ role: m.role, content: m.content });
  }
  // Chat-completions style tools → flat Responses tools. strict:false keeps optional parameters optional.
  const flat = tools.map((t) => { const f = (t as { function?: { name: string; description?: string; parameters?: unknown } }).function; return f ? { type: "function", name: f.name, description: f.description, parameters: f.parameters, strict: false } : t; });
  // Map the few extra parameters that differ between both APIs; chat-only ones are dropped instead of failing.
  const x: Record<string, unknown> = {};
  if (p.kind !== "azure_openai") {
    const e = extra(p);
    for (const k of ["temperature", "top_p", "parallel_tool_calls"]) if (k in e) x[k] = e[k];
    const cap = e["max_output_tokens"] ?? e["max_completion_tokens"] ?? e["max_tokens"]; if (cap !== undefined) x["max_output_tokens"] = cap;
    if (typeof e["reasoning_effort"] === "string") x["reasoning"] = { effort: e["reasoning_effort"] };
  }
  const headers = { ...(base.init.headers as Record<string, string>) };
  return { url, init: { method: "POST", headers, body: JSON.stringify({ model, stream: true, store: false, input, tools: flat, tool_choice: "auto", ...x }) } };
}

/** Azure Foundry partner models (e.g. NVIDIA Cosmos on *.services.ai.azure.com/openai/v1) can reject the api-key header or
 *  streaming with "azure-resource-enc"; the variant that worked is remembered per endpoint+deployment for this session. */
const azureVariant = new Map<string, { bearer: boolean; noStream: boolean }>();
const variantKey = (p: ProviderCall) => `${p.endpoint ?? ""}|${p.deployment ?? p.model}`;
export function applyAzureVariant(init: RequestInit, v: { bearer: boolean; noStream: boolean }, key: string): RequestInit {
  const headers = { ...(init.headers as Record<string, string>) };
  if (v.bearer) { delete headers["api-key"]; headers["authorization"] = `Bearer ${key}`; }
  let body = init.body;
  if (v.noStream && typeof body === "string") { try { const j = JSON.parse(body); j.stream = false; body = JSON.stringify(j); } catch { /* keep */ } }
  return { ...init, headers, body: body ?? null };
}
async function openStream(url: string, init: RequestInit, p: ProviderCall, signal?: AbortSignal): Promise<Response> {
  const azure = (p.kind === "azure_openai" || p.kind === "azure") && !!(init.headers as Record<string, string> | undefined)?.["api-key"];
  let variant = azure ? azureVariant.get(variantKey(p)) ?? { bearer: false, noStream: false } : null;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...(variant ? applyAzureVariant(init, variant, p.apiKey ?? "") : init), redirect: "error", signal: signal ?? null });
    if (res.ok && res.body) { if (variant && (variant.bearer || variant.noStream)) azureVariant.set(variantKey(p), variant); return res; }
    const body = await res.text().catch(() => "");
    if (isContentBlock(body)) throw responseError(res.status, body, p.apiKey);
    if (variant && /azure-resource-enc/i.test(body) && !(variant.bearer && variant.noStream)) {
      variant = !variant.bearer ? { bearer: true, noStream: false } : { bearer: true, noStream: true };
      continue;
    }
    if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const wait = rateLimitWaitMs(res, body, attempt);
      if (wait <= MAX_RATE_LIMIT_WAIT_MS) { await sleep(Math.max(0, wait), signal); continue; }
    }
    throw responseError(res.status, body, p.apiKey);
  }
}

async function readSse(res: Response, p: ProviderCall, onEvent: (parsed: any) => void) {
  // Non-streamed JSON answer (fallback variant): present it as one delta event.
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    const j = await res.json().catch(() => { throw new ProviderError("parameters", "Respuesta inválida: el proveedor no devolvió JSON válido."); });
    if (isContentBlock(JSON.stringify(j)) || j?.error || j?.type === "response.failed") throw responseError(res.status, JSON.stringify(j), p.apiKey);
    const msg = j?.choices?.[0]?.message;
    if (msg) onEvent({ ...j, choices: [{ ...j.choices[0], delta: { content: typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.map((c: any) => c?.text ?? "").join("") : "", ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}), ...(Array.isArray(msg.tool_calls) ? { tool_calls: msg.tool_calls.map((t: any, index: number) => ({ index, ...t })) } : {}) } }] });
    else onEvent(j);
    return;
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { throw new ProviderError("parameters", "Respuesta inválida: el proveedor no devolvió JSON válido."); }
    if (isContentBlock(data) || parsed.type === "response.refusal.delta" || parsed.type === "response.refusal.done") throw new ProviderError("content_blocked", "El proveedor bloqueó esta respuesta por su política de contenido. No es un límite de velocidad ni un error de parámetros. MI AI no reintentó el bloqueo.", res.status);
    if (parsed.error || parsed.type === "error") throw responseError(res.status, JSON.stringify(parsed.error ?? parsed), p.apiKey);
    if (parsed.type === "response.failed") throw responseError(res.status, JSON.stringify(parsed.response?.error ?? parsed), p.apiKey);
    onEvent(parsed);
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

const finishCalls = (calls: { id: string; name: string; arguments: string }[]): ToolCall[] =>
  calls.filter((c) => c && c.name).map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.arguments || "{}" }));

async function streamResponses(p: ProviderCall, messages: ChatMsg[], tools: unknown[], onDelta: (t: string) => void, signal?: AbortSignal): Promise<{ toolCalls: ToolCall[] }> {
  const { url, init } = buildResponsesRequest(p, messages, tools);
  const res = await openStream(url, init, p, signal);
  const byItem = new Map<string, { id: string; name: string; arguments: string }>();
  const order: string[] = [];
  const item = (key: string) => { let c = byItem.get(key); if (!c) { c = { id: "", name: "", arguments: "" }; byItem.set(key, c); order.push(key); } return c; };
  await readSse(res, p, (e) => {
    if (e.type === "response.output_text.delta" && typeof e.delta === "string" && e.delta) onDelta(e.delta);
    else if ((e.type === "response.output_item.added" || e.type === "response.output_item.done") && e.item?.type === "function_call") {
      const c = item(String(e.item.id ?? e.output_index));
      if (e.item.call_id) c.id = e.item.call_id;
      if (e.item.name) c.name = e.item.name;
      if (e.type === "response.output_item.done" && typeof e.item.arguments === "string") c.arguments = e.item.arguments; // authoritative
    } else if (e.type === "response.function_call_arguments.delta" && typeof e.delta === "string") item(String(e.item_id ?? e.output_index)).arguments += e.delta;
    else if (e.type === "response.function_call_arguments.done" && typeof e.arguments === "string") item(String(e.item_id ?? e.output_index)).arguments = e.arguments;
  });
  return { toolCalls: finishCalls(order.map((k) => byItem.get(k)!)) };
}

/** Streams text deltas. API key is only placed in request headers — never logged.
 *  With tools on OpenAI/Azure: models that refuse function tools on chat/completions are retried once on /responses. */
export async function streamChat(p: ProviderCall, messages: ChatMsg[], onDelta: (t: string) => void, signal?: AbortSignal, opts: { tools?: unknown[] } = {}): Promise<{ toolCalls: ToolCall[]; reasoning?: string }> {
  const tools = opts.tools?.length ? opts.tools : undefined;
  const viaResponses = !!tools && RESPONSES_KINDS.includes(p.kind);
  if (viaResponses && responsesForTools.has(responsesKey(p))) return streamResponses(p, messages, tools!, onDelta, signal);
  const { url, init, parse } = buildRequest(p, messages, tools);
  const calls: { id: string; name: string; arguments: string }[] = [];
  let res: Response;
  try { res = await openStream(url, init, p, signal); }
  catch (err) {
    if (!viaResponses || !(err instanceof ProviderError) || !isToolRejection(err.httpStatus, err.technical)) throw err;
    try {
      const out = await streamResponses(p, messages, tools!, onDelta, signal);
      responsesForTools.add(responsesKey(p));
      return out;
    } catch (second) {
      if ((second as Error)?.name === "AbortError") throw second;
      if (second instanceof ProviderError && (second.code === "content_blocked" || second.httpStatus === 403)) throw second;
      throw err; // Responses not available either: keep the original tool rejection for the caller's text-only fallback.
    }
  }
  let reasoning = "";
  await readSse(res, p, (parsed) => {
    const r = parsed.choices?.[0]?.delta?.reasoning_content;
    if (typeof r === "string") reasoning += r;
    const text = parse(parsed);
    if (typeof text === "string" && text) onDelta(text);
    const deltas = parsed.choices?.[0]?.delta?.tool_calls;
    if (Array.isArray(deltas)) for (const d of deltas) {
      const i = typeof d?.index === "number" ? d.index : calls.length;
      const c = (calls[i] ??= { id: "", name: "", arguments: "" });
      if (typeof d.id === "string" && d.id) c.id = d.id;
      if (typeof d.function?.name === "string") c.name += d.function.name;
      if (typeof d.function?.arguments === "string") c.arguments += d.function.arguments;
    }
  });
  return { toolCalls: finishCalls(calls), ...(reasoning ? { reasoning } : {}) };
}

export type DiagnosticCode = "key" | "auth" | "endpoint" | "model" | "unavailable" | "network" | "timeout" | "parameters" | "content_blocked";
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
  if (isContentBlock(body)) return new ProviderError("content_blocked", "El proveedor bloqueó esta respuesta por su política de contenido. No es un límite de velocidad ni un error de parámetros. MI AI no reintentó el bloqueo.", status, technical);
  const msg = technical.toLowerCase();
  let code: DiagnosticCode = "parameters";
  if (/invalid.{0,20}(api.?key|key)|api.?key.{0,20}(invalid|incorrect)|api_key_invalid/.test(msg)) code = "key";
  else if (status === 401 || status === 403 || /authentication|unauthorized|permission.denied/.test(msg)) code = "auth";
  else if (/model.*(not.found|does.not.exist|not.exist)|deploymentnotfound|deployment.*not.found|model_not_found/.test(msg)) code = "model";
  else if (status === 408 || status === 504) code = "timeout";
  else if (status === 429 || status >= 500 || /overloaded|capacity|unavailable|quota|resource_exhausted/.test(msg)) code = "unavailable";
  else if (status === 404 || status === 405) code = "endpoint";
  const labels: Record<DiagnosticCode, string> = { content_blocked: "El proveedor bloqueó esta respuesta por su política de contenido.", key: "API Key inválida.", auth: "Error de autenticación: revisa credenciales y permisos.", endpoint: "Endpoint incorrecto: revisa la dirección y la ruta del proveedor.", model: "Modelo o deployment inexistente.", unavailable: "Modelo sin disponibilidad: revisa cuota, límites o estado del servicio.", network: "Error de red.", timeout: "Error de red o timeout: el proveedor no respondió a tiempo.", parameters: "Parámetros incompatibles o respuesta inválida." };
  if (status === 429) {
    let reason = "";
    try { const j = JSON.parse(technical); reason = String(j?.error?.message ?? j?.message ?? ""); } catch { reason = technical; }
    reason = reason.replace(/\s+/g, " ").trim().slice(0, 220);
    const label = "El proveedor rechazó la solicitud por su propio límite de velocidad o cuota (HTTP 429). MI AI no limita los mensajes; se reintentó automáticamente. Si sigue pasando, aumenta los tokens por minuto del deployment en tu cuenta del proveedor o espera un momento."
      + (reason ? ` Detalle del proveedor: ${reason}` : "");
    return new ProviderError("unavailable", label, status, technical);
  }
  // Foundry answers this when a managed-compute model (e.g. NVIDIA Cosmos) is called through the resource URL.
  if (/azure-resource-enc/.test(msg)) return new ProviderError("endpoint", "Azure rechazó la llamada a este deployment de Foundry (falta «azure-resource-enc»). MI AI ya reintentó con la clave como Bearer y sin streaming. Revisa en Foundry que el deployment esté activo y que la clave sea de ese mismo recurso; si el deployment tiene su propio «URI de destino» (Target URI), usa ese URI y su clave.", status, technical);
  // Say why: the provider's own reason (redacted) goes next to the generic label, so chat notices are not a dead end.
  let reason = "";
  try { const j = JSON.parse(technical); reason = String(j?.error?.message ?? j?.message ?? ""); } catch { /* plain text body */ }
  reason = reason.replace(/\s+/g, " ").trim().slice(0, 220);
  const label = code === "unavailable" ? `${labels[code]}${status ? ` (HTTP ${status})` : ""}` : labels[code];
  return new ProviderError(code, reason ? `${label} Detalle del proveedor: ${reason}` : label, status, technical);
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
  const res = await fetch(ep.secrets, { method: "POST", headers, body: JSON.stringify({ session: realtimeConfig(deployment, "Prueba de conexión de MI AI.", "alloy") }), redirect: "error", signal });
  const body = await res.text().catch(() => "");
  if (!res.ok) throw responseError(res.status, body, p.apiKey);
  let token: any = null;
  try { token = JSON.parse(body); } catch { /* invalid below */ }
  const value = typeof token?.value === "string" ? token.value : typeof token?.client_secret?.value === "string" ? token.client_secret.value : null;
  if (!value) throw new ProviderError("parameters", "Respuesta inválida: Azure no devolvió una sesión de voz válida.", res.status);
}
/** Non-chat Azure deployments (voice, transcription, embeddings, images) are verified with a real request of their own kind. */
async function testAzureKind(p: ProviderCall, kind: Exclude<AzureDeploymentKind, "chat" | "realtime">, signal: AbortSignal): Promise<void> {
  const deployment = p.deployment?.trim();
  if (!deployment) throw new ProviderError("model", "Modelo o deployment inexistente: completa el deployment.");
  if (!p.apiKey?.trim()) throw new ProviderError("key", "API Key inválida: falta la credencial.");
  const { azureAdapter } = await import("./core/adapters/azure");
  const { testWav } = await import("./core/adapters/audio");
  const creds = { kind: p.kind, endpoint: p.endpoint, apiKey: p.apiKey, deployment, apiVersion: p.apiVersion ?? null, model: deployment, extraParams: p.extraParams ?? null };
  if (kind === "cosmos") {
    let resource = false; try { resource = isAzureResourceHost(new URL((p.endpoint ?? "").trim()).hostname); } catch { /* checked by the adapter */ }
    if (resource) { const { probeCosmosChat } = await import("./core/adapters/cosmos"); await probeCosmosChat(creds, deployment, signal); return; }
  }
  const out = kind === "cosmos" ? await azureAdapter.run(creds, { capability: "image.generate", model: deployment, prompt: "A small blue ball on a white table, studio light", params: { num_inference_steps: 8 }, signal })
    : kind === "tts" || kind === "audio-chat" ? await azureAdapter.run(creds, { capability: "audio.tts", model: deployment, prompt: "OK", signal })
    : kind === "transcribe" ? await azureAdapter.run(creds, { capability: "audio.transcribe", model: deployment, files: [{ bytes: testWav(), mime: "audio/wav", name: "prueba.wav" }], params: { allowEmpty: true }, signal })
    : kind === "embedding" ? await azureAdapter.run(creds, { capability: "embedding", model: deployment, prompt: "prueba", signal })
    : await azureAdapter.run(creds, { capability: "image.generate", model: deployment, prompt: "A small blue circle on a white background", params: /gpt-image/i.test(deployment) ? { quality: "low", n: 1 } : { n: 1 }, signal });
  const real = (out.kind === "files" && out.files.some((f) => f.bytes.length > 100)) || (out.kind === "text" && typeof out.text === "string") || (out.kind === "vectors" && (out.vectors[0]?.length ?? 0) > 0);
  if (!real) throw new ProviderError("parameters", "Respuesta inválida: el modelo no devolvió un resultado real.", 200);
}
/** Draft credentials stay only in memory. Success requires actual generated model text. */
export async function testProvider(p: ProviderCall, timeoutMs = 20000): Promise<ConnectionResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const kind = p.kind === "azure_openai" ? azureKindOf(p) : "chat";
  // A Cosmos test image runs on a GPU endpoint and can take a couple of minutes.
  const limit = kind === "cosmos" ? Math.max(timeoutMs, 300_000) : timeoutMs;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ProviderError("timeout", "Error de red o timeout: se agotó el tiempo de espera.")); }, limit); });
  try {
    if (kind === "realtime") {
      await Promise.race([testRealtime(p, controller.signal), timeout]);
      return { ok: true, checkedAt: Date.now() };
    }
    if (kind !== "chat") {
      await Promise.race([testAzureKind(p, kind, controller.signal), timeout]);
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
