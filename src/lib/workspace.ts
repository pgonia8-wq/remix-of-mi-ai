import type { Repo } from "./db/repo";
import type { Core } from "./core";
export type WorkspaceItem = { id: string; project_id: string; title: string; kind: string; asset_id: string | null; status: "todo" | "doing" | "review" | "done"; updated_at: number };
const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
export const workspace = {
  list(repo: Repo, p: string) { need(p); return repo.sql.all<WorkspaceItem>("SELECT * FROM workspace_items WHERE project_id=? ORDER BY updated_at DESC", [p]); },
  async add(core: Core, p: string, title: string, kind: string, assetId?: string) {
    need(p); if (!await core.repo.getProject(p) || !title.trim()) throw new Error("Proyecto o título no válido");
    if (assetId && !await core.assets.get(p, assetId)) throw new Error("Archivo ajeno al proyecto");
    const id = crypto.randomUUID();
    await core.repo.sql.run("INSERT INTO workspace_items VALUES (?,?,?,?,?,'todo',?)", [id, p, title.trim().slice(0, 200), kind, assetId ?? null, Date.now()]); return id;
  },
  move(repo: Repo, p: string, id: string, status: WorkspaceItem["status"]) { need(p); if (!["todo", "doing", "review", "done"].includes(status)) throw new Error("Estado incorrecto"); return repo.sql.run("UPDATE workspace_items SET status=?,updated_at=? WHERE project_id=? AND id=?", [status, Date.now(), p, id]); },
  remove(repo: Repo, p: string, id: string) { need(p); return repo.sql.run("DELETE FROM workspace_items WHERE project_id=? AND id=?", [p, id]); },
  favorites(repo: Repo, p: string) { need(p); return repo.sql.all<{ tool: string }>("SELECT tool FROM tool_favorites WHERE project_id=?", [p]); },
  favorite(repo: Repo, p: string, tool: string, on: boolean) { need(p); return repo.sql.run(on ? "INSERT OR IGNORE INTO tool_favorites VALUES (?,?)" : "DELETE FROM tool_favorites WHERE project_id=? AND tool=?", [p, tool]); },
};