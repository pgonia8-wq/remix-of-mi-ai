// Private Storage Cloud: project-scoped folders on an authorized PC Node. Metadata lives locally so a
// disconnected PC keeps its file list visible (marked unavailable) and older copies never overwrite newer ones.
import type { Repo } from "../db/repo";
import { rpc, nodes } from "./client";
import { b64, unb64 } from "./protocol";

export type NodeFolder = { id: string; project_id: string; node_id: string; root_index: number; label: string; quota_bytes: number | null; created_at: number };
export type SyncEntry = { id: string; project_id: string; folder_id: string; path: string; location: "pc" | "android" | "vm"; hash: string | null; remote_hash: string | null; version: number; state: "synced" | "pending" | "conflict" | "unavailable" | "deleted"; size: number; updated_at: number };
const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
async function sha256(bytes: Uint8Array) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join(""); }

export const folders = {
  list(repo: Repo, p: string) { need(p); return repo.sql.all<NodeFolder>("SELECT * FROM node_folders WHERE project_id=? ORDER BY created_at", [p]); },
  async get(repo: Repo, p: string, id: string) { need(p); return (await repo.sql.all<NodeFolder>("SELECT * FROM node_folders WHERE project_id=? AND id=?", [p, id]))[0] ?? null; },
  /** Explicit selection of one shared folder for one project. Whole-disk access does not exist. */
  async authorize(repo: Repo, p: string, nodeId: string, rootIndex: number, quotaBytes: number | null) {
    need(p); if (!await repo.getProject(p)) throw new Error("Proyecto inexistente");
    const n = await nodes.get(repo, nodeId); if (!n || n.revoked) throw new Error("Nodo no autorizado");
    const shared = await rpc<{ index: number; name: string }[]>(repo, nodeId, "folders.list", {});
    const f = shared.find((s) => s.index === rootIndex); if (!f) throw new Error("La PC no comparte esa carpeta");
    if (quotaBytes !== null && !(quotaBytes > 0)) throw new Error("Cuota inválida");
    const id = crypto.randomUUID();
    await repo.sql.run("INSERT INTO node_folders VALUES (?,?,?,?,?,?,?)", [id, p, nodeId, rootIndex, f.name, quotaBytes, Date.now()]);
    return id;
  },
  async remove(repo: Repo, p: string, id: string) { need(p); await repo.sql.run("DELETE FROM sync_entries WHERE project_id=? AND folder_id=?", [p, id]); await repo.sql.run("DELETE FROM node_folders WHERE project_id=? AND id=?", [p, id]); },
  entries(repo: Repo, p: string, folderId: string) { need(p); return repo.sql.all<SyncEntry>("SELECT * FROM sync_entries WHERE project_id=? AND folder_id=? ORDER BY path", [p, folderId]); },
};
async function folderFor(repo: Repo, p: string, folderId: string) {
  const f = await folders.get(repo, p, folderId); if (!f) throw new Error("Carpeta ajena al proyecto o no autorizada");
  const n = await nodes.get(repo, f.node_id); if (!n || n.revoked) throw new Error("Nodo revocado");
  return f;
}
const args = (f: NodeFolder, p: string, extra: Record<string, unknown>) => ({ rootIndex: f.root_index, projectId: p, ...extra });
async function entry(repo: Repo, p: string, folderId: string, path: string) {
  return (await repo.sql.all<SyncEntry>("SELECT * FROM sync_entries WHERE project_id=? AND folder_id=? AND path=?", [p, folderId, path]))[0] ?? null;
}
async function upsert(repo: Repo, p: string, folderId: string, path: string, v: Partial<SyncEntry>) {
  const e = await entry(repo, p, folderId, path);
  if (e) await repo.sql.run("UPDATE sync_entries SET hash=?, remote_hash=?, version=?, state=?, size=?, updated_at=? WHERE id=?", [v.hash ?? e.hash, v.remote_hash ?? e.remote_hash, v.version ?? e.version, v.state ?? e.state, v.size ?? e.size, Date.now(), e.id]);
  else await repo.sql.run("INSERT INTO sync_entries VALUES (?,?,?,?,?,?,?,?,?,?,?)", [crypto.randomUUID(), p, folderId, path, "pc", v.hash ?? null, v.remote_hash ?? null, v.version ?? 1, v.state ?? "synced", v.size ?? 0, Date.now()]);
}

export const pcFiles = {
  async list(repo: Repo, p: string, folderId: string, path = "") {
    const f = await folderFor(repo, p, folderId);
    try { return { online: true, files: await rpc<{ path: string; dir: boolean; size?: number }[]>(repo, f.node_id, "fs.list", args(f, p, { path })) }; }
    catch {
      // Offline: keep metadata, mark remote copies temporarily unavailable.
      await repo.sql.run("UPDATE sync_entries SET state='unavailable' WHERE project_id=? AND folder_id=? AND state='synced'", [p, folderId]);
      return { online: false, files: (await folders.entries(repo, p, folderId)).map((e) => ({ path: e.path, dir: false, size: e.size, state: e.state })) };
    }
  },
  async read(repo: Repo, p: string, folderId: string, path: string) {
    const f = await folderFor(repo, p, folderId);
    const r = await rpc<{ data: string; hash: string }>(repo, f.node_id, "fs.read", args(f, p, { path }));
    const bytes = unb64(r.data);
    if (await sha256(bytes) !== r.hash) throw new Error("Integridad fallida: el hash no coincide");
    return { bytes, hash: r.hash };
  },
  /** Write with optimistic concurrency: baseHash must equal the PC's current hash, else it is a conflict (never overwrite). */
  async write(repo: Repo, p: string, folderId: string, path: string, bytes: Uint8Array, baseHash: string | null) {
    const f = await folderFor(repo, p, folderId);
    const hash = await sha256(bytes);
    await upsert(repo, p, folderId, path, { hash, state: "pending", size: bytes.length });
    try {
      const r = await rpc<{ conflict: boolean; hash?: string; currentHash?: string | null }>(repo, f.node_id, "fs.write", args(f, p, { path, data: b64(bytes), baseHash, quotaBytes: f.quota_bytes }));
      if (r.conflict) { await upsert(repo, p, folderId, path, { state: "conflict", remote_hash: r.currentHash ?? null }); return { conflict: true as const, currentHash: r.currentHash ?? null }; }
      if (r.hash !== hash) throw new Error("Integridad fallida tras escribir");
      const e = await entry(repo, p, folderId, path);
      await upsert(repo, p, folderId, path, { state: "synced", remote_hash: hash, version: (e?.version ?? 0) + (e?.remote_hash ? 1 : 0) });
      return { conflict: false as const, hash };
    } catch (e) {
      // Stays "pending" locally; resumed later by sync(), which re-checks the base hash first.
      throw e;
    }
  },
  async remove(repo: Repo, p: string, folderId: string, path: string) { const f = await folderFor(repo, p, folderId); await rpc(repo, f.node_id, "fs.delete", args(f, p, { path })); await upsert(repo, p, folderId, path, { state: "deleted" }); },
  async versions(repo: Repo, p: string, folderId: string, path: string) { const f = await folderFor(repo, p, folderId); return rpc<string[]>(repo, f.node_id, "fs.versions", args(f, p, { path })); },
  async restore(repo: Repo, p: string, folderId: string, path: string, version: string) { const f = await folderFor(repo, p, folderId); const r = await rpc<{ hash: string }>(repo, f.node_id, "fs.restore", args(f, p, { path, version })); await upsert(repo, p, folderId, path, { state: "synced", remote_hash: r.hash, hash: r.hash }); return r; },
  /** Reconnect: refresh hashes; a remote file that changed while we had a pending local copy becomes a conflict. */
  async reconcile(repo: Repo, p: string, folderId: string) {
    const f = await folderFor(repo, p, folderId);
    const out = { synced: 0, conflicts: 0, pending: 0 };
    for (const e of await folders.entries(repo, p, folderId)) {
      if (e.state === "deleted") continue;
      const st = await rpc<{ exists: boolean; hash?: string | null }>(repo, f.node_id, "fs.stat", args(f, p, { path: e.path }));
      const remote = st.exists ? st.hash ?? null : null;
      if (e.state === "pending") { if (remote !== e.remote_hash && remote !== e.hash) { await upsert(repo, p, folderId, e.path, { state: "conflict", remote_hash: remote }); out.conflicts++; } else out.pending++; continue; }
      if (e.state === "conflict") { out.conflicts++; continue; }
      await upsert(repo, p, folderId, e.path, { state: "synced", remote_hash: remote }); out.synced++;
    }
    return out;
  },
};
