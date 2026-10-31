// Web search through Tavily (user's own key). Only search results come back; the report is written by a chat model.
import { ProviderError } from "../../providers";
import { call, requireKey } from "./http";
import { sync, trimSlash, type ProviderAdapter, type SearchResult } from "./types";

export function parseTavily(d: any): SearchResult[] {
  const rs = Array.isArray(d?.results) ? d.results : null;
  if (!rs) throw new ProviderError("parameters", "Respuesta inválida del buscador.", 200);
  return rs.filter((x: any) => typeof x?.url === "string").map((x: any) => ({ title: String(x.title ?? x.url), url: String(x.url), snippet: String(x.content ?? "").slice(0, 1500) }));
}

export const tavilyAdapter: ProviderAdapter = {
  id: "tavily",
  label: "Tavily (búsqueda web)",
  operations: { "research.web": sync() },
  supports(cap) { return cap in this.operations; },
  async run(c, r) {
    const key = requireKey(c.apiKey);
    if (r.capability !== "research.web") throw new ProviderError("parameters", `Tavily no implementa «${r.capability}».`);
    const query = (r.prompt ?? "").trim();
    if (!query) throw new ProviderError("parameters", "Escribe qué quieres investigar.");
    const res = await call(`${trimSlash(c.endpoint?.trim() || "https://api.tavily.com")}/search`, {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ query: query.slice(0, 400), max_results: Math.min(10, Number(r.params?.["max"] ?? 6)), search_depth: r.params?.["deep"] ? "advanced" : "basic", include_answer: false }),
      signal: r.signal ?? null,
    }, key);
    return { kind: "search", results: parseTavily(await res.json()) };
  },
};
