// Automatic reactions to files and events. Rules run only free, local, deterministic actions (tag, read text into a
// note, create a task, notify). Anything that could cost money becomes a *proposal* the person opens by hand —
// reactions never call providers, never start runs and never approve anything.
import type { Core } from "../core";
import type { Asset } from "../core/asset-store";

export type ReactionEvent = "file.added" | "run.completed" | "run.needs_person";
export type ReactionAction = "tag" | "extract_text" | "task" | "notify" | "propose";
export type ReactionRule = { id: string; project_id: string; name: string; event: ReactionEvent; filter: string; action: ReactionAction; param: string; enabled: number; created_at: number };
export type ReactionLog = { id: string; project_id: string; rule_id: string; event: string; subject: string; status: "hecho" | "propuesta" | "error" | "omitida"; detail: string; created_at: number };
export type EventData = { name: string; mime?: string; assetId?: string; runId?: string; capability?: string | null };

export const EVENTS: Record<ReactionEvent, string> = { "file.added": "Llega un archivo nuevo", "run.completed": "Un trabajo de agentes termina", "run.needs_person": "Un trabajo de agentes necesita tu decisión" };
export const ACTIONS: Record<ReactionAction, string> = { tag: "Etiquetar el archivo", extract_text: "Leer su texto y guardarlo como nota", task: "Crear una tarea", notify: "Avisarme en el teléfono", propose: "Proponerme una acción con IA (yo decido)" };
const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
const fill = (tpl: string, d: EventData) => tpl.replace(/\{nombre\}/g, d.name).replace(/\{tipo\}/g, d.mime ?? "");

/** Filter: comma-separated extensions (".pdf,.jpg"), MIME prefixes ("image/") or words contained in the name. Empty = all. */
export function matchesFilter(filter: string, d: EventData) {
  const parts = filter.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return true;
  const n = d.name.toLowerCase(), m = (d.mime ?? "").toLowerCase();
  return parts.some((f) => f.startsWith(".") ? n.endsWith(f) : f.includes("/") ? m.startsWith(f) : n.includes(f));
}

export const reactions = {
  list: (core: Core, p: string) => { need(p); return core.repo.sql.all<ReactionRule>("SELECT * FROM reaction_rules WHERE project_id=? ORDER BY created_at", [p]); },
  async add(core: Core, p: string, r: { name: string; event: ReactionEvent; filter?: string; action: ReactionAction; param?: string }) {
    need(p);
    if (!EVENTS[r.event] || !ACTIONS[r.action]) throw new Error("Regla no válida.");
    if (r.event !== "file.added" && (r.action === "tag" || r.action === "extract_text")) throw new Error("Esa acción solo aplica a archivos.");
    if ((r.action === "tag" && !/^[\wáéíóúñü -]{1,40}$/i.test(r.param ?? "")) || (r.action === "propose" && !(r.param ?? "").trim())) throw new Error(r.action === "tag" ? "Escribe una etiqueta corta." : "Escribe qué te debe proponer.");
    const id = crypto.randomUUID();
    await core.repo.sql.run("INSERT INTO reaction_rules VALUES (?,?,?,?,?,?,?,1,?)", [id, p, r.name.trim().slice(0, 80) || ACTIONS[r.action], r.event, (r.filter ?? "").slice(0, 200), r.action, (r.param ?? "").slice(0, 1000), Date.now()]);
    return id;
  },
  toggle: (core: Core, p: string, id: string, on: boolean) => { need(p); return core.repo.sql.run("UPDATE reaction_rules SET enabled=? WHERE project_id=? AND id=?", [on ? 1 : 0, p, id]); },
  remove: (core: Core, p: string, id: string) => { need(p); return core.repo.sql.run("DELETE FROM reaction_rules WHERE project_id=? AND id=?", [p, id]); },
  log: (core: Core, p: string, limit = 50) => { need(p); return core.repo.sql.all<ReactionLog>("SELECT * FROM reaction_log WHERE project_id=? ORDER BY created_at DESC LIMIT ?", [p, limit]); },
  dismiss: (core: Core, p: string, id: string) => { need(p); return core.repo.sql.run("UPDATE reaction_log SET status='omitida' WHERE project_id=? AND id=?", [p, id]); },
};

export type ReactionDeps = { notify?: (title: string, body: string) => Promise<void>; extract?: (bytes: Uint8Array, name: string, mime: string) => Promise<string> };

/** Applies every enabled matching rule. Files created by reactions themselves never trigger rules (no loops). */
export async function react(core: Core, p: string, event: ReactionEvent, d: EventData, deps: ReactionDeps = {}) {
  need(p);
  if (d.capability === "reaction") return [];
  const rules = (await reactions.list(core, p)).filter((r) => r.enabled && r.event === event && matchesFilter(r.filter, d));
  const out: ReactionLog["status"][] = [];
  for (const r of rules) {
    let status: ReactionLog["status"] = "hecho", detail = "";
    try {
      if (r.action === "tag") { if (!d.assetId) throw new Error("Sin archivo"); await core.assets.tag(p, d.assetId, r.param); detail = `Etiqueta «${r.param}»`; }
      else if (r.action === "extract_text") {
        if (!d.assetId) throw new Error("Sin archivo");
        const a = await core.assets.get(p, d.assetId); if (!a) throw new Error("Archivo no encontrado");
        if (a.size > 50 * 1024 * 1024) throw new Error("Archivo demasiado grande para leer automáticamente");
        const bytes = await core.assets.read(p, d.assetId);
        const text = deps.extract ? await deps.extract(bytes, d.name, d.mime ?? "") : (a.mime.startsWith("text/") ? new TextDecoder().decode(bytes) : (await (await import("../docs/extract")).extractText(bytes, d.name, a.mime)).text);
        const { notes } = await import("../core/productivity");
        await notes.save(core.repo.sql, p, { title: `Texto de ${d.name}`.slice(0, 80), body: text.slice(0, 60_000) || "(sin texto legible)" });
        detail = `${text.length} caracteres guardados en Notas`;
      } else if (r.action === "task") { const { tasks } = await import("../core/productivity"); await tasks.add(core.repo.sql, p, { title: fill(r.param || "Revisar {nombre}", d).slice(0, 500) }); detail = "Tarea creada"; }
      else if (r.action === "notify") { await deps.notify?.(r.name, fill(r.param || "{nombre}", d)); detail = "Aviso enviado"; }
      else if (r.action === "propose") { status = "propuesta"; detail = fill(r.param, d); }
    } catch (e) { status = "error"; detail = (e as Error).message.slice(0, 200); }
    await core.repo.sql.run("INSERT INTO reaction_log VALUES (?,?,?,?,?,?,?,?)", [crypto.randomUUID(), p, r.id, event, JSON.stringify({ name: d.name, assetId: d.assetId ?? null, runId: d.runId ?? null }), status, detail, Date.now()]);
    out.push(status);
  }
  return out;
}

export const assetEvent = (a: Asset): EventData => ({ name: a.name ?? a.id, mime: a.mime, assetId: a.id, capability: a.capability_id });
