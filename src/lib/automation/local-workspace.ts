// Phone workspace: a project-scoped file tree kept inside the encrypted app database, so autonomous agents can
// write, read, search and version files with no PC Node or VM. Same contract as the PC workspace (hash-checked
// writes, recoverable versions) so the fs.* tools behave identically in both environments.
import type { Repo } from "../db/repo";
import { sha256Hex } from "./approvals";

export const LOCAL_WS_LIMITS = { fileBytes: 400_000, totalBytes: 50 * 1024 * 1024, files: 2000, versionsPerFile: 20 };
export type LocalFile = { path: string; size: number; hash: string; updated_at: number };

const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
/** Normalizes a project-relative path; rejects absolute paths, traversal, drive letters and control characters. */
export function normPath(raw: string) {
  const s = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
  if (!s || s.startsWith("/") || /^[a-zA-Z]:/.test(s) || s.split("/").some((x) => x === ".." || x === ".") || /[\u0000-\u001f]/.test(s) || s.length > 400) throw new Error("Ruta fuera del espacio del proyecto");
  return s;
}
const enc = new TextEncoder();

export const localWs = {
  async list(repo: Repo, p: string, dir = ""): Promise<LocalFile[]> {
    need(p); const prefix = dir ? `${normPath(dir)}/` : "";
    const rows = await repo.sql.all<LocalFile>("SELECT path, size, hash, updated_at FROM local_ws_files WHERE project_id=? ORDER BY path", [p]);
    return rows.filter((r) => r.path.startsWith(prefix));
  },
  async read(repo: Repo, p: string, path: string) {
    need(p); const [r] = await repo.sql.all<{ content: string; hash: string }>("SELECT content, hash FROM local_ws_files WHERE project_id=? AND path=?", [p, normPath(path)]);
    if (!r) throw new Error(`No existe ${path}`);
    if (await sha256Hex(r.content) !== r.hash) throw new Error(`Integridad fallida en ${path}`);
    return { text: r.content, hash: r.hash };
  },
  /** Optimistic concurrency: baseHash must match the current version (null = new file). */
  async write(repo: Repo, p: string, path: string, content: string, baseHash: string | null): Promise<{ hash: string; conflict?: false } | { conflict: true; currentHash: string | null }> {
    need(p); const at = normPath(path); const size = enc.encode(content).length;
    if (size > LOCAL_WS_LIMITS.fileBytes) throw new Error(`Archivo demasiado grande para el espacio del teléfono (máx. ${LOCAL_WS_LIMITS.fileBytes / 1000} KB).`);
    const [cur] = await repo.sql.all<{ content: string; hash: string; size: number }>("SELECT content, hash, size FROM local_ws_files WHERE project_id=? AND path=?", [p, at]);
    if ((cur?.hash ?? null) !== baseHash) return { conflict: true, currentHash: cur?.hash ?? null };
    const [{ n, total }] = await repo.sql.all<{ n: number; total: number | null }>("SELECT COUNT(*) n, SUM(size) total FROM local_ws_files WHERE project_id=?", [p]) as [{ n: number; total: number | null }];
    if (!cur && n >= LOCAL_WS_LIMITS.files) throw new Error("El espacio del teléfono alcanzó el máximo de archivos.");
    if ((total ?? 0) - (cur?.size ?? 0) + size > LOCAL_WS_LIMITS.totalBytes) throw new Error("El espacio del teléfono alcanzó su tamaño máximo.");
    const hash = await sha256Hex(content), now = Date.now();
    if (cur) await keepVersion(repo, p, at, cur.content, cur.hash);
    await repo.sql.run("INSERT INTO local_ws_files VALUES (?,?,?,?,?,?) ON CONFLICT(project_id, path) DO UPDATE SET content=excluded.content, hash=excluded.hash, size=excluded.size, updated_at=excluded.updated_at", [p, at, content, hash, size, now]);
    return { hash };
  },
  async remove(repo: Repo, p: string, path: string) {
    need(p); const at = normPath(path);
    const [cur] = await repo.sql.all<{ content: string; hash: string }>("SELECT content, hash FROM local_ws_files WHERE project_id=? AND path=?", [p, at]);
    if (!cur) throw new Error(`No existe ${path}`);
    await keepVersion(repo, p, at, cur.content, cur.hash);
    await repo.sql.run("DELETE FROM local_ws_files WHERE project_id=? AND path=?", [p, at]);
  },
  async search(repo: Repo, p: string, query: string) {
    need(p); const q = query.toLowerCase(); const out: { path: string; line: number; text: string }[] = [];
    const rows = await repo.sql.all<{ path: string; content: string }>("SELECT path, content FROM local_ws_files WHERE project_id=? ORDER BY path", [p]);
    for (const r of rows) {
      if (r.path.toLowerCase().includes(q)) out.push({ path: r.path, line: 0, text: "(nombre)" });
      r.content.split("\n").forEach((l, i) => { if (out.length < 300 && l.toLowerCase().includes(q)) out.push({ path: r.path, line: i + 1, text: l.slice(0, 240) }); });
    }
    return out;
  },
  versions(repo: Repo, p: string, path: string) {
    need(p); return repo.sql.all<{ version: string; hash: string; created_at: number }>("SELECT version, hash, created_at FROM local_ws_versions WHERE project_id=? AND path=? ORDER BY created_at DESC", [p, normPath(path)]);
  },
  async restore(repo: Repo, p: string, path: string, version: string) {
    need(p); const at = normPath(path);
    const [v] = await repo.sql.all<{ content: string }>("SELECT content FROM local_ws_versions WHERE project_id=? AND path=? AND version=?", [p, at, version]);
    if (!v) throw new Error("Versión inexistente en este proyecto");
    const [cur] = await repo.sql.all<{ hash: string }>("SELECT hash FROM local_ws_files WHERE project_id=? AND path=?", [p, at]);
    const r = await localWs.write(repo, p, at, v.content, cur?.hash ?? null);
    if (r.conflict) throw new Error("El archivo cambió durante la restauración");
    return { restored: version, hash: r.hash };
  },
  async usage(repo: Repo, p: string) {
    need(p); const [{ n, total }] = await repo.sql.all<{ n: number; total: number | null }>("SELECT COUNT(*) n, SUM(size) total FROM local_ws_files WHERE project_id=?", [p]) as [{ n: number; total: number | null }];
    return { files: n, bytes: total ?? 0 };
  },
};

async function keepVersion(repo: Repo, p: string, path: string, content: string, hash: string) {
  const version = `${Date.now()}-${hash.slice(0, 12)}`;
  await repo.sql.run("INSERT OR IGNORE INTO local_ws_versions VALUES (?,?,?,?,?,?,?)", [crypto.randomUUID(), p, path, version, content, hash, Date.now()]);
  const old = await repo.sql.all<{ id: string }>("SELECT id FROM local_ws_versions WHERE project_id=? AND path=? ORDER BY created_at DESC LIMIT -1 OFFSET ?", [p, path, LOCAL_WS_LIMITS.versionsPerFile]);
  for (const o of old) await repo.sql.run("DELETE FROM local_ws_versions WHERE id=? AND project_id=?", [o.id, p]);
}
