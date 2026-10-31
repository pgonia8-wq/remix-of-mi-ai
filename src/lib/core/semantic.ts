// Semantic memory: chunks of documents, memory, notes and chats embedded with the user's embedding model.
// Vectors stay in the local encrypted database, scoped by project.
import type { SqlDb } from "../db/sql";
import type { Core } from "./index";
import { route } from "./router";
import { execute } from "./executor";
import { EMBED_BATCH } from "./adapters/embeddings";

export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const t = text.replace(/\s+\n/g, "\n").trim();
  if (!t) return [];
  const out: string[] = [];
  for (let i = 0; i < t.length; i += size - overlap) {
    let end = Math.min(t.length, i + size);
    if (end < t.length) { const cut = t.lastIndexOf(" ", end); if (cut > i + size / 2) end = cut; }
    out.push(t.slice(i, end).trim());
    if (end >= t.length) break;
    i = end - (size - overlap);
  }
  return out.filter(Boolean);
}

export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export type Source = { type: "document" | "memory" | "note" | "message"; id: string; label: string; text: string };

export async function collectSources(core: Core, projectId: string): Promise<Source[]> {
  const db = core.repo.sql;
  const docs = await core.repo.listDocs(projectId);
  const mem = await core.repo.listMemory(projectId);
  const ns = await db.all<{ id: string; title: string; body: string }>(`SELECT id, title, body FROM notes WHERE project_id=?`, [projectId]);
  const msgs = await db.all<{ id: string; content: string; title: string }>(`SELECT m.id, m.content, c.title FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.project_id=? AND length(m.content) > 40 ORDER BY m.created_at DESC LIMIT 300`, [projectId]);
  return [
    ...docs.filter((d) => d.text_content).map((d) => ({ type: "document" as const, id: d.id, label: d.name, text: d.text_content! })),
    ...mem.map((m) => ({ type: "memory" as const, id: m.id, label: `Memoria (${m.kind})`, text: m.content })),
    ...ns.map((n) => ({ type: "note" as const, id: n.id, label: `Nota: ${n.title}`, text: `${n.title}\n${n.body}` })),
    ...msgs.map((m) => ({ type: "message" as const, id: m.id, label: `Chat: ${m.title}`, text: m.content })),
  ];
}

export async function indexProject(core: Core, projectId: string, onProgress?: (done: number, total: number) => void) {
  const d = route(await core.repo.registry.listModels(), { capability: "embedding", mode: "auto" });
  if (!d.ok) throw new Error(d.reason);
  const db = core.repo.sql;
  const existing = new Set((await db.all<{ k: string }>(`SELECT source_type || ':' || source_id AS k FROM embeddings WHERE project_id=? AND model_id=?`, [projectId, d.model.id])).map((r) => r.k));
  const sources = await collectSources(core, projectId);
  const pending: { s: Source; i: number; text: string }[] = [];
  for (const s of sources) if (!existing.has(`${s.type}:${s.id}`)) chunkText(s.text).forEach((text, i) => pending.push({ s, i, text }));
  // Remove vectors whose source was deleted.
  const live = new Set(sources.map((s) => `${s.type}:${s.id}`));
  for (const k of existing) if (!live.has(k)) { const [t, id] = k.split(":"); await db.run(`DELETE FROM embeddings WHERE project_id=? AND source_type=? AND source_id=?`, [projectId, t!, id!]); }
  for (let b = 0; b < pending.length; b += EMBED_BATCH) {
    const batch = pending.slice(b, b + EMBED_BATCH);
    const r = await execute(core, projectId, d.model, { capability: "embedding", params: { inputs: batch.map((x) => x.text) } });
    for (const [j, x] of batch.entries()) {
      await db.run(`INSERT OR REPLACE INTO embeddings (id, project_id, source_type, source_id, chunk_index, text, vector, model_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), projectId, x.s.type, x.s.id, x.i, x.text, JSON.stringify(r.vectors![j]), d.model.id, Date.now()]);
    }
    onProgress?.(Math.min(pending.length, b + EMBED_BATCH), pending.length);
  }
  return { added: pending.length, model: d.model.name };
}

export type Hit = { source_type: string; source_id: string; text: string; score: number };

export async function searchProject(core: Core, projectId: string, query: string, k = 5): Promise<Hit[]> {
  const d = route(await core.repo.registry.listModels(), { capability: "embedding", mode: "auto" });
  if (!d.ok) return [];
  const rows = await core.repo.sql.all<{ source_type: string; source_id: string; text: string; vector: string }>(`SELECT source_type, source_id, text, vector FROM embeddings WHERE project_id=? AND model_id=?`, [projectId, d.model.id]);
  if (!rows.length) return [];
  const r = await execute(core, projectId, d.model, { capability: "embedding", params: { inputs: [query.slice(0, 4000)] } });
  return rankHits(r.vectors![0]!, rows, k);
}

export function rankHits(q: number[], rows: { source_type: string; source_id: string; text: string; vector: string }[], k: number): Hit[] {
  return rows.map((x) => ({ source_type: x.source_type, source_id: x.source_id, text: x.text, score: cosine(q, JSON.parse(x.vector) as number[]) }))
    .filter((h) => h.score > 0.2).sort((a, b) => b.score - a.score).slice(0, k);
}

export const indexStats = (db: SqlDb, projectId: string) => db.all<{ model_id: string; n: number }>(`SELECT model_id, COUNT(*) AS n FROM embeddings WHERE project_id=? GROUP BY model_id`, [projectId]);
