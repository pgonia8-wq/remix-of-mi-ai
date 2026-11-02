// Web research: plan sub-queries → open metasearch or optional provider → cited report.
import type { Core } from "./index";
import { route } from "./router";
import { execute } from "./executor";
import { askModel, extractJson } from "./ai";
import type { SearchResult } from "./adapters/types";

export type ReadSource = SearchResult & { read: boolean; excerpt: string };
export type ClaimCheck = { claim: string; cites: number[]; status: "respaldada" | "parcial" | "sin respaldo" | "sin cita"; reason: string };
export type ResearchResult = { report: string; sources: ReadSource[]; queries: string[]; rounds: number; invalidCitations: number[]; assetId: string | null; checks: ClaimCheck[] };

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
export function htmlToText(html: string, max = 20_000) {
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
    const text = type.includes("html") ? htmlToText(body) : body.slice(0, 20_000);
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

// ---------- passage selection and claim verification (pure, unit-tested) ----------
const STOP = new Set("de la el en y a los las del que por con para un una se su al lo como más o es son fue han ha sus este esta entre sobre sin también pero ya muy the of and to in is for on that with by are as from at be this an or".split(" "));
const words = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9ñ]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];
const numbersIn = (t: string) => [...t.matchAll(/\d[\d.,]*\d|\d/g)].map((m) => m[0].replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")).filter((n) => n.length > 0 && !/^[0-9]$/.test(n));
/** Most relevant passages of a long page for the question (instead of only its beginning). */
export function bestPassages(text: string, query: string, n = 4, size = 700): string {
  const q = new Set(words(query)); if (!q.size || text.length <= size * n) return text.slice(0, size * n);
  const chunks: { i: number; s: string; score: number }[] = [];
  for (let i = 0; i < text.length; i += Math.floor(size * 0.8)) { const s = text.slice(i, i + size); const w = words(s); chunks.push({ i, s, score: w.filter((x) => q.has(x)).length / Math.sqrt(w.length + 1) }); }
  return chunks.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map((c) => c.s.trim()).join(" … ");
}
/** Sentences of the report that state facts, with the source numbers they cite. */
export function extractClaims(report: string): { claim: string; cites: number[] }[] {
  const body = report.split(/\n#+\s*(Fuentes|Limitaciones|Verificación)/i)[0] ?? report;
  return body.split(/\n+/).filter((l) => !/^\s*#/.test(l)).flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/))
    .map((t) => t.replace(/^\s*[-*•\d.)]+\s*/, "").trim()).filter((t) => t.length > 40 && words(t).length >= 5)
    .map((claim) => ({ claim, cites: [...new Set([...claim.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1])))] }));
}
/** Deterministic support check: every figure in the claim must appear in a cited source, plus word overlap. */
export function lexicalSupport(claim: string, sourceText: string) {
  const src = sourceText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""), srcNums = new Set(numbersIn(sourceText));
  const nums = numbersIn(claim.replace(/\[\d{1,3}\]/g, "")), missing = nums.filter((n) => !srcNums.has(n));
  const w = [...new Set(words(claim.replace(/\[\d{1,3}\]/g, "")))], hit = w.filter((x) => src.includes(x)).length;
  return { missingNumbers: missing, overlap: w.length ? hit / w.length : 0 };
}

export async function runResearch(core: Core, projectId: string, question: string, opts: { deep: boolean; onStep?: (s: string) => void }): Promise<ResearchResult> {
  const models = await core.repo.registry.listModels();
  const search = route(models, { capability: "research.web", mode: "auto" });
  if (!search.ok) throw new Error(search.reason + " Agrega SearXNG en Modelos.");
  let queries = [question];
  if (opts.deep) {
    opts.onStep?.("Planificando búsquedas…");
    try {
      const plan = await askModel(core, projectId, `Divide esta pregunta de investigación en 5 búsquedas web cortas y distintas que cubran definiciones, datos recientes, cifras, opiniones contrarias y fuentes oficiales. Devuelve solo JSON: {"queries":["..."]}\n\nPregunta: ${question}`);
      const q = extractJson<{ queries: string[] }>(plan.text).queries?.filter((x) => typeof x === "string" && x.trim()).slice(0, 5);
      if (q?.length) queries = [question, ...q];
    } catch { /* fall back to the original question */ }
  }
  const all: SearchResult[] = [];
  const searchAll = async (qs: string[]) => { for (const q of qs) {
    opts.onStep?.(`Buscando: ${q}`);
    const r = await execute(core, projectId, search.model, { capability: "research.web", prompt: q, params: { max: opts.deep ? 6 : 8, deep: opts.deep } });
    all.push(...(r.results ?? []).filter((x) => isSafeSourceUrl(x.url)));
  } };
  await searchAll(queries);
  let rounds = 1;
  // Deep: up to two extra rounds asking what is still uncovered (or contradicted) and searching those gaps.
  for (let extra = 0; opts.deep && all.length && extra < 2; extra++) {
    opts.onStep?.(`Ronda ${rounds + 1}: buscando lo que falta…`);
    try {
      const gap = await askModel(core, projectId, `Pregunta: ${question}\nResultados ya encontrados:\n${dedupeSources(all).slice(0, 18).map((s) => `- ${s.title}: ${s.snippet.slice(0, 160)}`).join("\n")}\n\n¿Qué aspectos importantes faltan, qué datos necesitan confirmación en otra fuente o qué afirmaciones se contradicen? Devuelve solo JSON {"queries":["..."]} con hasta 3 búsquedas nuevas, o {"queries":[]} si no falta nada.`);
      const more = extractJson<{ queries: string[] }>(gap.text).queries?.filter((x) => typeof x === "string" && x.trim() && !queries.includes(x)).slice(0, 3) ?? [];
      if (!more.length) break;
      queries = [...queries, ...more]; await searchAll(more); rounds++;
    } catch { break; }
  }
  const found = dedupeSources(all).slice(0, opts.deep ? 20 : 15);
  if (!found.length) throw new Error("La búsqueda no devolvió resultados.");
  const sources: ReadSource[] = [];
  for (const [i, s] of found.entries()) {
    if (opts.deep && i < 12) { opts.onStep?.(`Leyendo fuente ${i + 1}: ${s.title.slice(0, 50)}`); sources.push(await readSource(s)); }
    else sources.push({ ...s, read: false, excerpt: s.snippet });
  }
  opts.onStep?.("Redactando informe con fuentes…");
  const ctx = sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.read ? "Pasajes relevantes de la página:" : "Resumen del buscador:"}\n${s.read ? bestPassages(s.excerpt, question, 4) : s.excerpt.slice(0, 400)}`).join("\n\n");
  const prompt = `Eres un investigador riguroso. Responde en español a la pregunta usando SOLO las fuentes numeradas. Cita cada afirmación con [n] justo al final de la oración; copia las cifras exactamente como aparecen en la fuente. Si las fuentes no bastan o se contradicen, dilo. Estructura: resumen breve, desarrollo con encabezados, y "Limitaciones". No inventes fuentes ni URLs.\n\nPregunta: ${question}\n\nFuentes:\n${ctx}`;
  const ans = await askModel(core, projectId, prompt);
  let text = ans.text.trim();
  const checks: ClaimCheck[] = [];
  if (opts.deep) {
    opts.onStep?.("Verificando cada dato contra su fuente…");
    const claims = extractClaims(text).slice(0, 30);
    const pending: { idx: number; passage: string }[] = [];
    for (const c of claims) {
      const valid = c.cites.filter((n) => n >= 1 && n <= sources.length);
      if (!valid.length) { checks.push({ ...c, status: "sin cita", reason: "La oración no cita ninguna fuente." }); continue; }
      const srcText = valid.map((n) => sources[n - 1]!.excerpt).join("\n");
      const lex = lexicalSupport(c.claim, srcText);
      if (lex.missingNumbers.length) { checks.push({ ...c, status: "sin respaldo", reason: `Cifra no encontrada en la fuente: ${lex.missingNumbers.join(", ")}.` }); continue; }
      checks.push({ ...c, status: lex.overlap >= 0.5 ? "respaldada" : "parcial", reason: `Coincidencia de términos ${(lex.overlap * 100).toFixed(0)} %.` });
      pending.push({ idx: checks.length - 1, passage: valid.map((n) => `[${n}] ${bestPassages(sources[n - 1]!.excerpt, c.claim, 2, 500)}`).join("\n") });
    }
    if (pending.length) {
      try {
        const judge = await askModel(core, projectId, `Revisa si cada afirmación está respaldada por el pasaje de su fuente. Responde solo JSON {"r":[{"i":número,"s":"respaldada"|"parcial"|"sin respaldo","m":"motivo breve"}]}.\n\n${pending.map((p, k) => `#${k}\nAfirmación: ${checks[p.idx]!.claim}\nPasajes:\n${p.passage}`).join("\n\n")}`);
        for (const r of extractJson<{ r: { i: number; s: string; m?: string }[] }>(judge.text).r ?? []) {
          const p = pending[r.i]; if (!p || !["respaldada", "parcial", "sin respaldo"].includes(r.s)) continue;
          const c = checks[p.idx]!; c.status = r.s as ClaimCheck["status"]; c.reason = (r.m ?? c.reason).slice(0, 200);
        }
      } catch { /* deterministic checks remain */ }
    }
    for (const c of checks) if (c.status === "sin respaldo" || c.status === "sin cita") text = text.replace(c.claim, `${c.claim} ⚠️ *(no verificado)*`);
  }
  const verif = checks.length ? `\n\n## Verificación de datos\n${checks.filter((c) => c.status !== "respaldada").length ? "" : "Todas las afirmaciones revisadas tienen respaldo en sus fuentes.\n"}| Estado | Afirmación | Fuentes | Motivo |\n|---|---|---|---|\n${checks.map((c) => `| ${c.status} | ${c.claim.replace(/\|/g, "/").slice(0, 160)} | ${c.cites.join(", ") || "—"} | ${c.reason.replace(/\|/g, "/")} |`).join("\n")}` : "";
  const report = `${text}${verif}\n\n## Fuentes\n${sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})${s.read ? " — página leída" : " — solo resumen del buscador"}`).join("\n")}`;
  const bytes = new TextEncoder().encode(`# ${question}\n\n${report}`);
  const asset = await core.assets.put(projectId, (async function* () { yield bytes; })(), { kind: "text", mime: "text/markdown", name: `investigacion-${question.slice(0, 40).replace(/[^\w áéíóúñ-]/gi, "")}.md`, capability: "research.web", prompt: question, params: { queries, deep: opts.deep, rounds, verified: checks.length } });
  await core.assets.tag(projectId, asset.id, "investigación");
  return { report, sources, queries, rounds, invalidCitations: invalidCitations(ans.text, sources.length), assetId: asset.id, checks };
}
