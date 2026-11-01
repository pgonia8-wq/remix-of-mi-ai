// Web research: plan sub-queries → open metasearch or optional provider → cited report.
import type { Core } from "./index";
import { route } from "./router";
import { execute } from "./executor";
import { askModel, extractJson } from "./ai";
import type { SearchResult } from "./adapters/types";

export type ResearchResult = { report: string; sources: SearchResult[]; queries: string[]; invalidCitations: number[]; assetId: string | null };

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
  for (const q of queries) {
    opts.onStep?.(`Buscando: ${q}`);
    const r = await execute(core, projectId, search.model, { capability: "research.web", prompt: q, params: { max: opts.deep ? 5 : 8, deep: opts.deep } });
    all.push(...(r.results ?? []));
  }
  const sources = dedupeSources(all).slice(0, 15);
  if (!sources.length) throw new Error("La búsqueda no devolvió resultados.");
  opts.onStep?.("Redactando informe con fuentes…");
  const ctx = sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet}`).join("\n\n");
  const prompt = `Eres un investigador riguroso. Responde en español a la pregunta usando SOLO las fuentes numeradas. Cita cada afirmación con [n]. Si las fuentes no bastan o se contradicen, dilo. Estructura: resumen breve, desarrollo con encabezados, y "Limitaciones". No inventes fuentes ni URLs.\n\nPregunta: ${question}\n\nFuentes:\n${ctx}`;
  const ans = await askModel(core, projectId, prompt);
  const report = `${ans.text.trim()}\n\n## Fuentes\n${sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join("\n")}`;
  const bytes = new TextEncoder().encode(`# ${question}\n\n${report}`);
  const asset = await core.assets.put(projectId, (async function* () { yield bytes; })(), { kind: "text", mime: "text/markdown", name: `investigacion-${question.slice(0, 40).replace(/[^\w áéíóúñ-]/gi, "")}.md`, capability: "research.web", prompt: question, params: { queries, deep: opts.deep } });
  await core.assets.tag(projectId, asset.id, "investigación");
  return { report, sources, queries, invalidCitations: invalidCitations(ans.text, sources.length), assetId: asset.id };
}
