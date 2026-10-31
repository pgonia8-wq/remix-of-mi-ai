import type { ProviderKind } from "./db/repo";

export const PROVIDER_KINDS: { kind: ProviderKind; label: string; endpoint: string; model: string; needsDeployment?: boolean; needsVersion?: boolean }[] = [
  { kind: "openai", label: "OpenAI", endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { kind: "anthropic", label: "Anthropic", endpoint: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-latest" },
  { kind: "gemini", label: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-1.5-flash" },
  { kind: "azure", label: "Azure AI Foundry", endpoint: "https://TU-RECURSO.openai.azure.com", model: "gpt-4o", needsDeployment: true, needsVersion: true },
  { kind: "xai", label: "xAI", endpoint: "https://api.x.ai/v1", model: "grok-2-latest" },
  { kind: "deepseek", label: "DeepSeek", endpoint: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { kind: "mistral", label: "Mistral", endpoint: "https://api.mistral.ai/v1", model: "mistral-large-latest" },
  { kind: "cohere", label: "Cohere", endpoint: "https://api.cohere.com/v2", model: "command-r-plus" },
  { kind: "openai_compatible", label: "Compatible OpenAI", endpoint: "http://localhost:11434/v1", model: "llama3.1" },
  { kind: "custom", label: "Endpoint personalizado", endpoint: "https://", model: "modelo" },
];

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
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
    return JSON.parse(p.extraParams);
  } catch {
    throw new Error("Parámetros extra: JSON no válido");
  }
}
const trim = (s: string) => s.replace(/\/+$/, "");

function buildRequest(p: ProviderCall, messages: ChatMsg[]): { url: string; init: RequestInit; parse: (data: any) => string | null } {
  const ep = trim(p.endpoint || PROVIDER_KINDS.find((k) => k.kind === p.kind)!.endpoint);
  const key = p.apiKey ?? "";
  const x = extra(p);
  if (p.kind === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    return {
      url: `${ep}/messages`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": p.apiVersion || "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: p.model, max_tokens: 4096, stream: true, system: system || undefined, messages: messages.filter((m) => m.role !== "system"), ...x }),
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
          contents: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
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
  if (p.kind === "azure") {
    url = `${ep}/openai/deployments/${encodeURIComponent(p.deployment || p.model)}/chat/completions?api-version=${encodeURIComponent(p.apiVersion || "2024-10-21")}`;
    headers["api-key"] = key;
  } else if (key) headers["authorization"] = `Bearer ${key}`;
  return {
    url,
    init: { method: "POST", headers, body: JSON.stringify({ model: p.model, stream: true, messages, ...x }) },
    parse: (d) => d.choices?.[0]?.delta?.content ?? null,
  };
}

/** Streams text deltas. API key is only placed in request headers — never logged. */
export async function streamChat(p: ProviderCall, messages: ChatMsg[], onDelta: (t: string) => void, signal?: AbortSignal) {
  const { url, init, parse } = buildRequest(p, messages);
  const res = await fetch(url, { ...init, signal: signal ?? null });
  if (!res.ok || !res.body) {
    const body = (await res.text().catch(() => "")).slice(0, 400);
    throw new Error(`El proveedor respondió ${res.status}${body ? `: ${body}` : ""}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const t = parse(JSON.parse(data));
        if (t) onDelta(t);
      } catch {
        /* partial line */
      }
    }
  }
}

export async function testProvider(p: ProviderCall): Promise<string> {
  let out = "";
  await streamChat(p, [{ role: "user", content: "Responde solo: OK" }], (t) => (out += t));
  return out.trim() || "(respuesta vacía)";
}
