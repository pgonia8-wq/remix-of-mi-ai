// Web research: plan sub-queries → open metasearch or optional provider → cited report.
import type { Core } from "./index";
import { route } from "./router";
import { execute } from "./executor";
import { askModel, extractJson } from "./ai";
import type { SearchResult } from "./adapters/types";

export type ReadSource = SearchResult & { read: boolean; excerpt: string };
export type ResearchResult = { report: string; sources: ReadSource[]; queries: string[]; rounds: number; invalidCitations: number[]; assetId: string | null };

/** Only public https pages may be opened: no credentials, localhost, private networks or non-web schemes. */
export function isSafeSourceUrl(raw: string) {
  let u: URL; try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "[::1]") return false;
  if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.1[89]\.)/.test(h)) return false;
  // Any IPv6 literal (incl. ::ffff:mapped, ::, ULA, link-local) and integer/hex/octal IPv4 encodings are refused.
  if (h.startsWith("[") || /^(0x[0-9a-f]+|\d+)$/i.test(h) || /^[\d.]+$/.test(h) && h.split(".").some((p) => p.length > 1 && p.startsWith("0"))) return false;
  if (!h.includes(".")) return false;
  return true;
}

/** Readable text from HTML without executing anything (scripts/styles/nav removed). */
export function htmlToText(html: string, max = 6000) {
  const cleaned = html.replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n").replace(/<[^>]+>/g, " ");
  const decoded = cleaned.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return decoded.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, max);
}

/** Opens a source page without cookies or keys; redirects are refused. Failure keeps the search snippet. */
export async function readSource(s: SearchResult, fetcher: typeof fetch = fetch, timeoutMs = 8000): Promise<ReadSource> {
  if (!isSafeSourceUrl(s.url)) return { ...s, read: false, excerpt: s.snippet };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetcher(s.url, { credentials: "omit", redirect: "error", signal: ctl.signal, headers: { accept: "text/html,text/plain" } });
    if (res.url && res.url !== s.url && !isSafeSourceUrl(res.url)) return { ...s, read: false, excerpt: s.snippet };
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/text\/(html|plain)/.test(type)) return { ...s, read: false, excerpt: s.snippet };
    const body = (await res.text()).slice(0, 1_500_000);
    const text = type.includes("html") ? htmlToText(body) : body.slice(0, 6000);
    return text.length > 200 ? { ...s, read: true, excerpt: text } : { ...s, read: false, excerpt: s.snippet };
  } catch { return { ...s, read: false, excerpt: s.snippet }; } finally { clearTimeout(t); }
}

export function dedupeSources(list: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return list.filter((s) => { const k = s.url.replace(/[#?].*$/, "").replace(/\/$/, ""); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Citation numbers in the report that do not correspond to a real source. */
export function invalidCitations(report: string, n: number): number[] {
  const nums = [...report.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]));
  return [...new Set(nums.filter((x) => x < 1 || x > n))];
}

export async function runResearch(core: Core, projectId: string, question: string, opts: { deep: boolean; onStep?: (s: string) => void }): Promise<ResearchResult> {
  const models = await core.repo.registry.listModels();
  const search = route(models, { capability: "research.web", mode: "auto" });
  if (!search.ok) throw new Error(search.reason + " Agrega SearXNG en Modelos.");
  let queries = [question];
  if (opts.deep) {
    opts.onStep?.("Planificando búsquedas…");
    try {
      const plan = await askModel(core, projectId, `Divide esta pregunta de investigación en 3 búsquedas web cortas y distintas. Devuelve solo JSON: {"queries":["..."]}\n\nPregunta: ${question}`);
      const q = extractJson<{ queries: string[] }>(plan.text).queries?.filter((x) => typeof x === "string" && x.trim()).slice(0, 3);
      if (q?.length) queries = [question, ...q];
    } catch { /* fall back to the original question */ }
  }
  const all: SearchResult[] = [];
  const searchAll = async (qs: string[]) => { for (const q of qs) {
    opts.onStep?.(`Buscando: ${q}`);
    const r = await execute(core, projectId, search.model, { capability: "research.web", prompt: q, params: { max: opts.deep ? 5 : 8, deep: opts.deep } });
    all.push(...(r.results ?? []).filter((x) => isSafeSourceUrl(x.url)));
  } };
  await searchAll(queries);
  let rounds = 1;
  if (opts.deep && all.length) {
    // Round 2: ask which aspects remain uncovered by the first results, then search those gaps.
    opts.onStep?.("Buscando lo que falta…");
    try {
      const gap = await askModel(core, projectId, `Pregunta: ${question}\nResultados ya encontrados:\n${dedupeSources(all).slice(0, 12).map((s) => `- ${s.title}: ${s.snippet.slice(0, 160)}`).join("\n")}\n\n¿Qué aspectos importantes faltan? Devuelve solo JSON {"queries":["..."]} con hasta 2 búsquedas nuevas, o {"queries":[]} si no falta nada.`);
      const more = extractJson<{ queries: string[] }>(gap.text).queries?.filter((x) => typeof x === "string" && x.trim() && !queries.includes(x)).slice(0, 2) ?? [];
      if (more.length) { queries = [...queries, ...more]; await searchAll(more); rounds = 2; }
    } catch { /* keep first round */ }
  }
  const found = dedupeSources(all).slice(0, 15);
  if (!found.length) throw new Error("La búsqueda no devolvió resultados.");
  const sources: ReadSource[] = [];
  for (const [i, s] of found.entries()) {
    if (opts.deep && i < 8) { opts.onStep?.(`Leyendo fuente ${i + 1}: ${s.title.slice(0, 50)}`); sources.push(await readSource(s)); }
    else sources.push({ ...s, read: false, excerpt: s.snippet });
  }
  opts.onStep?.("Redactando informe con fuentes…");
  const ctx = sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.read ? "Texto de la página (extracto):" : "Resumen del buscador:"}\n${s.excerpt.slice(0, s.read ? 3000 : 400)}`).join("\n\n");
  const prompt = `Eres un investigador riguroso. Responde en español a la pregunta usando SOLO las fuentes numeradas. Cita cada afirmación con [n]. Si las fuentes no bastan o se contradicen, dilo. Estructura: resumen breve, desarrollo con encabezados, y "Limitaciones". No inventes fuentes ni URLs.\n\nPregunta: ${question}\n\nFuentes:\n${ctx}`;
  const ans = await askModel(core, projectId, prompt);
  const report = `${ans.text.trim()}\n\n## Fuentes\n${sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})${s.read ? " — página leída" : " — solo resumen del buscador"}`).join("\n")}`;
  const bytes = new TextEncoder().encode(`# ${question}\n\n${report}`);
  const asset = await core.assets.put(projectId, (async function* () { yield bytes; })(), { kind: "text", mime: "text/markdown", name: `investigacion-${question.slice(0, 40).replace(/[^\w áéíóúñ-]/gi, "")}.md`, capability: "research.web", prompt: question, params: { queries, deep: opts.deep, rounds } });
  await core.assets.tag(projectId, asset.id, "investigación");
  return { report, sources, queries, rounds, invalidCitations: invalidCitations(ans.text, sources.length), assetId: asset.id };
}
