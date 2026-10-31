// Text tasks (documents, research, study) run through the Model Router on the exact "chat" capability.
import { route, type RouteMode } from "./router";
import { execute } from "./executor";
import type { Core } from "./index";

export const MAX_SOURCE_CHARS = 60_000;

export async function askModel(core: Core, projectId: string, prompt: string, opts: { mode?: RouteMode; manualModelId?: string | null; save?: { name: string; parentAssetId?: string | null } } = {}) {
  const d = route(await core.repo.registry.listModels(), { capability: "chat", mode: opts.mode ?? "auto", manualModelId: opts.manualModelId ?? null });
  if (!d.ok) throw new Error(d.reason);
  const r = await execute(core, projectId, d.model, { capability: "chat", prompt, ...(opts.save ? { saveText: true, parentAssetId: opts.save.parentAssetId ?? null } : {}) });
  if (opts.save && r.assets[0]) await core.assets.rename(projectId, r.assets[0].id, opts.save.name);
  return { text: r.text ?? "", model: d.model, asset: r.assets[0] ?? null };
}

/** Extracts the first JSON object/array from a model answer (tolerates ```json fences and surrounding prose). */
export function extractJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const src = fenced ? fenced[1]! : text;
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error("El modelo no devolvió datos estructurados. Intenta de nuevo.");
  const open = src[start]!, close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!;
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(src.slice(start, i + 1)) as T;
  }
  throw new Error("Respuesta estructurada incompleta. Intenta de nuevo.");
}

export const clipSource = (t: string, max = MAX_SOURCE_CHARS) => (t.length > max ? `${t.slice(0, max)}\n\n[… documento recortado a ${max} caracteres]` : t);
