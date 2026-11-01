// Per-run working memory: persisted, bounded, secret-scrubbed. External content is stored as untrusted data
// and rendered inside a data envelope so it can never act as instructions.
import { scrubSecrets, type Repo } from "../db/repo";

export type MemKind = "goal" | "plan" | "decision" | "observation" | "external" | "review" | "summary" | "file";
export type MemEntry = { id: string; project_id: string; run_id: string; kind: MemKind; content: string; created_at: number };
const LIMIT = 24_000;
const scrub = (s: string) => String(scrubSecrets({ detail: s }).detail);
export const workingMemory = {
  async add(repo: Repo, p: string, runId: string, kind: MemKind, content: string) {
    if (!p) throw new Error("projectId requerido");
    await repo.sql.run("INSERT INTO auto_memory VALUES (?,?,?,?,?,?)", [crypto.randomUUID(), p, runId, kind, scrub(content).slice(0, 6000), Date.now()]);
    await workingMemory.compact(repo, p, runId);
  },
  list(repo: Repo, p: string, runId: string) { return repo.sql.all<MemEntry>("SELECT * FROM auto_memory WHERE project_id=? AND run_id=? ORDER BY created_at, rowid", [p, runId]); },
  /** Older observations fold into one summary entry; goal, plan and reviews are kept verbatim. */
  async compact(repo: Repo, p: string, runId: string) {
    const all = await workingMemory.list(repo, p, runId);
    let total = all.reduce((n, e) => n + e.content.length, 0);
    if (total <= LIMIT) return;
    const foldable = all.filter((e) => ["observation", "external", "decision", "file", "summary"].includes(e.kind));
    const fold: MemEntry[] = [];
    for (const e of foldable) { if (total <= LIMIT * 0.6) break; fold.push(e); total -= e.content.length; }
    if (!fold.length) return;
    const text = fold.map((e) => `- [${e.kind}] ${e.content.replace(/\s+/g, " ").slice(0, 160)}`).join("\n").slice(0, 4000);
    for (const e of fold) await repo.sql.run("DELETE FROM auto_memory WHERE id=?", [e.id]);
    await repo.sql.run("INSERT INTO auto_memory VALUES (?,?,?,?,?,?)", [crypto.randomUUID(), p, runId, "summary", `Resumen acumulado:\n${text}`, fold[0]!.created_at]);
  },
  async render(repo: Repo, p: string, runId: string) {
    const all = await workingMemory.list(repo, p, runId);
    return all.map((e) => e.kind === "external" || e.kind === "observation"
      ? `<datos_no_confiables tipo="${e.kind}">${e.content.replace(/<\/?datos_no_confiables[^>]*>/g, "")}</datos_no_confiables>`
      : `[${e.kind}] ${e.content}`).join("\n").slice(-LIMIT);
  },
};
