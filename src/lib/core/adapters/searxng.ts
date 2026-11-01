// SearXNG is an open-source metasearch service. Calls stay on-device;
// the chosen instance must enable JSON output and permit access from the app.
import { ProviderError } from "../../providers";
import { call } from "./http";
import { sync, type ProviderAdapter, type SearchResult } from "./types";

export function searxngUrl(endpoint: string | null, query: string, deep = false) {
  let url: URL;
  try { url = new URL(endpoint?.trim() ?? ""); }
  catch { throw new ProviderError("endpoint", "Introduce la URL HTTPS de una instancia SearXNG."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new ProviderError("endpoint", "SearXNG requiere HTTPS sin credenciales ni parámetros en la URL.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/search$/, "")}/search`;
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  if (deep) url.searchParams.set("pageno", "1");
  return url.toString();
}

export function parseSearxng(data: unknown, max = 8): SearchResult[] {
  if (!data || typeof data !== "object" || !("results" in data) || !Array.isArray(data.results)) {
    throw new ProviderError("parameters", "La instancia SearXNG no devolvió resultados JSON. Comprueba que tenga el formato JSON habilitado.");
  }
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const value of data.results) {
    if (!value || typeof value !== "object" || typeof value.url !== "string") continue;
    let url: URL;
    try { url = new URL(value.url); } catch { continue; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    results.push({ url: url.href, title: typeof value.title === "string" ? value.title : url.hostname, snippet: typeof value.content === "string" ? value.content.slice(0, 1500) : "" });
    if (results.length >= Math.min(15, Math.max(1, Number.isFinite(max) ? Math.floor(max) : 8))) break;
  }
  return results;
}

export const searxngAdapter: ProviderAdapter = {
  id: "searxng", label: "SearXNG · búsqueda abierta",
  operations: { "research.web": sync() },
  supports(capability) { return capability === "research.web"; },
  async run(credentials, request) {
    if (!this.supports(request.capability)) throw new ProviderError("parameters", "SearXNG solo realiza búsquedas web.");
    const query = request.prompt?.trim();
    if (!query) throw new ProviderError("parameters", "Escribe qué quieres buscar.");
    const response = await call(searxngUrl(credentials.endpoint, query, !!request.params?.["deep"]), {
      headers: { accept: "application/json" }, credentials: "omit", redirect: "error", signal: request.signal ?? null,
    }, null, 20_000);
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new ProviderError("parameters", "SearXNG devolvió una página en lugar de JSON. Revisa permisos, protección anti-bots y formato JSON.", response.status); }
    return { kind: "search", results: parseSearxng(data, Number(request.params?.["max"] ?? 8)) };
  },
};