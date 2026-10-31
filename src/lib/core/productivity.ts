// Notes and tasks, always filtered by project.
import type { SqlDb } from "../db/sql";

export type Note = { id: string; project_id: string; title: string; body: string; pinned: number; updated_at: number };
export type Task = { id: string; project_id: string; title: string; done: number; due_at: number | null; priority: number; created_at: number };
const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
const uid = () => crypto.randomUUID();

export const notes = {
  list(db: SqlDb, projectId: string, q = "") {
    need(projectId);
    const like = `%${q.replace(/[%_]/g, "")}%`;
    return db.all<Note>(`SELECT * FROM notes WHERE project_id=? AND (title LIKE ? OR body LIKE ?) ORDER BY pinned DESC, updated_at DESC`, [projectId, like, like]);
  },
  async save(db: SqlDb, projectId: string, n: { id?: string; title: string; body: string; pinned?: boolean }) {
    need(projectId);
    const title = n.title.trim() || n.body.trim().split("\n")[0]!.slice(0, 60) || "Nota";
    if (n.id) { await db.run(`UPDATE notes SET title=?, body=?, pinned=?, updated_at=? WHERE id=? AND project_id=?`, [title, n.body, n.pinned ? 1 : 0, Date.now(), n.id, projectId]); return n.id; }
    const id = uid();
    await db.run(`INSERT INTO notes (id, project_id, title, body, pinned, updated_at) VALUES (?,?,?,?,?,?)`, [id, projectId, title, n.body, n.pinned ? 1 : 0, Date.now()]);
    return id;
  },
  remove: (db: SqlDb, projectId: string, id: string) => { need(projectId); return db.run(`DELETE FROM notes WHERE id=? AND project_id=?`, [id, projectId]); },
};

export const tasks = {
  list(db: SqlDb, projectId: string) {
    need(projectId);
    return db.all<Task>(`SELECT * FROM tasks WHERE project_id=? ORDER BY done ASC, CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, priority ASC, created_at DESC`, [projectId]);
  },
  async add(db: SqlDb, projectId: string, t: { title: string; dueAt?: number | null; priority?: number }) {
    need(projectId);
    if (!t.title.trim()) throw new Error("La tarea necesita un título.");
    const id = uid();
    await db.run(`INSERT INTO tasks (id, project_id, title, done, due_at, priority, created_at) VALUES (?,?,?,0,?,?,?)`, [id, projectId, t.title.trim(), t.dueAt ?? null, Math.min(3, Math.max(1, t.priority ?? 2)), Date.now()]);
    return id;
  },
  toggle: (db: SqlDb, projectId: string, id: string, done: boolean) => { need(projectId); return db.run(`UPDATE tasks SET done=? WHERE id=? AND project_id=?`, [done ? 1 : 0, id, projectId]); },
  remove: (db: SqlDb, projectId: string, id: string) => { need(projectId); return db.run(`DELETE FROM tasks WHERE id=? AND project_id=?`, [id, projectId]); },
};

/** Parses "- [ ] tarea" / "1. tarea" lines produced by a model into task titles. */
export function parseTaskLines(text: string): string[] {
  return text.split("\n").map((l) => /^\s*(?:[-*•]\s*(?:\[[ xX]?\]\s*)?|\d+[.)]\s+)(.+)$/.exec(l)?.[1]?.trim()).filter((x): x is string => !!x && x.length > 1).slice(0, 50);
}

export type Template = { id: string; label: string; instructions: string };
export const DOC_TEMPLATES: Template[] = [
  { id: "informe", label: "Informe", instructions: "Escribe un informe profesional con título, resumen ejecutivo, secciones con encabezados, conclusiones y recomendaciones." },
  { id: "carta", label: "Carta formal", instructions: "Escribe una carta formal con lugar y fecha, destinatario, saludo, cuerpo claro y despedida." },
  { id: "acta", label: "Acta de reunión", instructions: "Escribe un acta de reunión: asistentes, orden del día, acuerdos, responsables y fechas en una tabla." },
  { id: "propuesta", label: "Propuesta", instructions: "Escribe una propuesta: objetivo, alcance, entregables, cronograma (tabla), costos (tabla) y siguientes pasos." },
  { id: "presentacion", label: "Presentación (esquema)", instructions: "Escribe el contenido de una presentación: una sección '## Diapositiva N: título' por diapositiva con 3–5 viñetas." },
  { id: "hoja", label: "Hoja de cálculo", instructions: "Devuelve los datos como una o más tablas Markdown limpias con encabezados; números sin símbolos de moneda." },
  { id: "libre", label: "Libre", instructions: "Escribe el documento solicitado con formato Markdown claro." },
];
