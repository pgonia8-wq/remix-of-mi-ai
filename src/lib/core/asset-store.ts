// Universal asset library. Encrypted bytes live outside SQLite (private files on Android); rows hold metadata.
import type { SqlDb } from "../db/sql";
import { encryptAsset, readAll, verifyAsset, newDek, type ByteSource } from "./asset-crypto";
import type { KeyRing } from "./keys";
import type { PerfProfile } from "./device-profile";
import { exclusive } from "./operation-lock";

export interface BlobBackend {
  create(path: string): Promise<void>;
  append(path: string, bytes: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  source(path: string): Promise<ByteSource>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export type Asset = {
  id: string; project_id: string; kind: string; mime: string; format: string | null; size: number; path: string; key_id: number; wrapped_dek: string;
  enc_state: "encrypted" | "corrupt"; provider_id: string | null; model_id: string | null; capability_id: string | null; prompt: string | null; params: string | null;
  job_id: string | null; parent_id: string | null; version: number; name: string | null; created_at: number;
};
export type NewAsset = {
  kind: string; mime: string; format?: string | null; name?: string | null; providerId?: string | null; modelId?: string | null; capability?: string | null;
  prompt?: string | null; params?: unknown; jobId?: string | null; parentId?: string | null;
};

export class AssetError extends Error {}
const now = () => Date.now();
function need(projectId: string) { if (!projectId) throw new AssetError("projectId requerido"); }
const kindOf = (mime: string) => mime.split("/")[0] === "application" ? "document" : mime.split("/")[0]!;

export class AssetStore {
  constructor(private db: SqlDb, private fs: BlobBackend, private keys: KeyRing, private profile: () => PerfProfile) {}

  private dir(projectId: string) { return `assets/${projectId}`; }

  /**
   * Atomic, encrypted-from-first-byte write:
   * temp file → stream-encrypt → verify integrity → rename → register row. An interruption never registers an incomplete asset.
   */
  async put(projectId: string, data: AsyncIterable<Uint8Array>, meta: NewAsset): Promise<Asset> {
    return exclusive(this.db, () => this.putLocked(projectId, data, meta));
  }

  private async putLocked(projectId: string, data: AsyncIterable<Uint8Array>, meta: NewAsset): Promise<Asset> {
    need(projectId);
    const [proj] = await this.db.all(`SELECT id FROM projects WHERE id=?`, [projectId]);
    if (!proj) throw new AssetError("Proyecto inexistente");
    if (meta.parentId && !(await this.get(projectId, meta.parentId))) throw new AssetError("El activo de origen no pertenece al proyecto");
    const id = crypto.randomUUID();
    const tmp = `${this.dir(projectId)}/.tmp-${id}`;
    const final = `${this.dir(projectId)}/${id}.miai`;
    const dek = newDek();
    const p = this.profile();
    try {
      const { keyId, wrapped } = await this.keys.wrapDek(dek, id, projectId);
      await this.fs.create(tmp);
      const it = encryptAsset(data, { assetId: id, projectId }, dek, { blockSize: p.blockSize, concurrency: p.concurrency });
      let res: IteratorResult<Uint8Array, { blocks: number; size: number }>;
      while (!(res = await it.next()).done) await this.fs.append(tmp, res.value);
      const { size } = res.value;
      await verifyAsset(await this.fs.source(tmp), { assetId: id, projectId }, dek);
      await this.fs.rename(tmp, final);
      let version = 1;
      if (meta.parentId) {
        const [r] = await this.db.all<{ v: number }>(`SELECT MAX(version) AS v FROM assets WHERE project_id=? AND (id=? OR parent_id=?)`, [projectId, meta.parentId, meta.parentId]);
        version = (r?.v ?? 1) + 1;
      }
      const row: Asset = {
        id, project_id: projectId, kind: meta.kind || kindOf(meta.mime), mime: meta.mime, format: meta.format ?? meta.mime.split("/")[1] ?? null, size, path: final,
        key_id: keyId, wrapped_dek: wrapped, enc_state: "encrypted", provider_id: meta.providerId ?? null, model_id: meta.modelId ?? null, capability_id: meta.capability ?? null,
        prompt: meta.prompt ?? null, params: meta.params === undefined ? null : JSON.stringify(meta.params), job_id: meta.jobId ?? null, parent_id: meta.parentId ?? null,
        version, name: meta.name ?? null, created_at: now(),
      };
      await this.db.run(
        `INSERT INTO assets (id, project_id, kind, mime, format, size, path, key_id, wrapped_dek, enc_state, provider_id, model_id, capability_id, prompt, params, job_id, parent_id, version, name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [row.id, row.project_id, row.kind, row.mime, row.format, row.size, row.path, row.key_id, row.wrapped_dek, row.enc_state, row.provider_id, row.model_id, row.capability_id, row.prompt, row.params, row.job_id, row.parent_id, row.version, row.name, row.created_at],
      );
      if (meta.parentId) await this.relate(projectId, meta.parentId, id, "version", meta.jobId ?? null);
      return row;
    } catch (e) {
      // Roll back the row too (e.g. relate failed after INSERT) so no metadata points at a deleted file.
      await this.db.run(`DELETE FROM asset_relations WHERE project_id=? AND to_asset=?`, [projectId, id]).catch(() => undefined);
      await this.db.run(`DELETE FROM assets WHERE id=? AND project_id=?`, [id, projectId]).catch(() => undefined);
      await this.fs.remove(tmp).catch(() => undefined);
      await this.fs.remove(final).catch(() => undefined);
      throw e;
    } finally { dek.fill(0); }
  }

  async get(projectId: string, id: string): Promise<Asset | null> {
    need(projectId);
    return (await this.db.all<Asset>(`SELECT * FROM assets WHERE project_id=? AND id=?`, [projectId, id]))[0] ?? null;
  }
  async list(projectId: string, q?: { kind?: string; search?: string; tag?: string }): Promise<Asset[]> {
    need(projectId);
    let sql = `SELECT a.* FROM assets a WHERE a.project_id=?`;
    const params: (string | number)[] = [projectId];
    if (q?.kind) { sql += ` AND a.kind=?`; params.push(q.kind); }
    if (q?.search) { const like = `%${q.search.replace(/[%_]/g, "")}%`; sql += ` AND (a.name LIKE ? OR a.prompt LIKE ? OR a.mime LIKE ?)`; params.push(like, like, like); }
    if (q?.tag) { sql += ` AND EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id=a.id AND t.project_id=a.project_id AND t.tag=?)`; params.push(q.tag); }
    return this.db.all<Asset>(sql + ` ORDER BY a.created_at DESC`, params);
  }

  /** Whole version family (root → every derived version), oldest first, scoped to the project. */
  async versions(projectId: string, id: string): Promise<Asset[]> {
    need(projectId);
    let root = await this.get(projectId, id);
    for (let i = 0; root?.parent_id && i < 100; i++) { const p = await this.get(projectId, root.parent_id); if (!p) break; root = p; }
    if (!root) return [];
    const out: Asset[] = [root];
    for (let i = 0; i < out.length && out.length < 500; i++) {
      out.push(...await this.db.all<Asset>(`SELECT * FROM assets WHERE project_id=? AND parent_id=? ORDER BY created_at`, [projectId, out[i]!.id]));
    }
    return out.sort((x, y) => x.created_at - y.created_at);
  }

  /** Plaintext only after full verification (header, every block, final record). */
  async read(projectId: string, id: string): Promise<Uint8Array> {
    const a = await this.get(projectId, id);
    if (!a) throw new AssetError("Activo no pertenece al proyecto");
    const dek = await this.keys.unwrapDek(a.key_id, a.wrapped_dek, a.id, a.project_id);
    try { return await readAll(await this.fs.source(a.path), { assetId: a.id, projectId: a.project_id }, dek); }
    catch (e) { await this.db.run(`UPDATE assets SET enc_state='corrupt' WHERE id=? AND project_id=?`, [id, projectId]); throw e; }
    finally { dek.fill(0); }
  }
  async verify(projectId: string, id: string) {
    const a = await this.get(projectId, id);
    if (!a) throw new AssetError("Activo no pertenece al proyecto");
    const dek = await this.keys.unwrapDek(a.key_id, a.wrapped_dek, a.id, a.project_id);
    try { return await verifyAsset(await this.fs.source(a.path), { assetId: a.id, projectId: a.project_id }, dek); } finally { dek.fill(0); }
  }
  async remove(projectId: string, id: string) {
    const a = await this.get(projectId, id);
    if (!a) throw new AssetError("Activo no pertenece al proyecto");
    await this.db.run(`DELETE FROM asset_tags WHERE project_id=? AND asset_id=?`, [projectId, id]);
    await this.db.run(`DELETE FROM asset_relations WHERE project_id=? AND (from_asset=? OR to_asset=?)`, [projectId, id, id]);
    await this.db.run(`DELETE FROM assets WHERE project_id=? AND id=?`, [projectId, id]);
    await this.fs.remove(a.path).catch(() => undefined);
  }
  async rename(projectId: string, id: string, name: string) {
    need(projectId);
    await this.db.run(`UPDATE assets SET name=? WHERE project_id=? AND id=?`, [name, projectId, id]);
  }
  async tag(projectId: string, id: string, tag: string) {
    if (!(await this.get(projectId, id))) throw new AssetError("Activo no pertenece al proyecto");
    await this.db.run(`INSERT OR IGNORE INTO asset_tags (project_id, asset_id, tag) VALUES (?,?,?)`, [projectId, id, tag.trim().toLowerCase()]);
  }
  async untag(projectId: string, id: string, tag: string) {
    need(projectId);
    await this.db.run(`DELETE FROM asset_tags WHERE project_id=? AND asset_id=? AND tag=?`, [projectId, id, tag]);
  }
  async tags(projectId: string, id?: string) {
    need(projectId);
    return id
      ? (await this.db.all<{ tag: string }>(`SELECT tag FROM asset_tags WHERE project_id=? AND asset_id=?`, [projectId, id])).map((r) => r.tag)
      : (await this.db.all<{ tag: string }>(`SELECT DISTINCT tag FROM asset_tags WHERE project_id=? ORDER BY tag`, [projectId])).map((r) => r.tag);
  }
  async relate(projectId: string, from: string, to: string, relation: string, jobId: string | null = null) {
    if (!(await this.get(projectId, from)) || !(await this.get(projectId, to))) throw new AssetError("Relación entre proyectos distintos no permitida");
    await this.db.run(`INSERT INTO asset_relations (id, project_id, from_asset, to_asset, relation, job_id) VALUES (?,?,?,?,?,?)`, [crypto.randomUUID(), projectId, from, to, relation, jobId]);
  }
  relations(projectId: string, id: string) {
    need(projectId);
    return this.db.all<{ from_asset: string; to_asset: string; relation: string }>(`SELECT from_asset, to_asset, relation FROM asset_relations WHERE project_id=? AND (from_asset=? OR to_asset=?)`, [projectId, id, id]);
  }

  /** On start: delete abandoned temp files and encrypted files whose row no longer exists (e.g. deleted project). */
  async cleanup(): Promise<{ temps: number; orphans: number }> {
    return exclusive(this.db, () => this.cleanupLocked());
  }

  private async cleanupLocked(): Promise<{ temps: number; orphans: number }> {
    const files = await this.fs.list("assets/");
    const known = new Set((await this.db.all<{ path: string }>(`SELECT path FROM assets`)).map((r) => r.path));
    let temps = 0, orphans = 0;
    for (const f of files) {
      if (f.split("/").pop()!.startsWith(".tmp-")) { await this.fs.remove(f); temps++; }
      else if (!known.has(f)) { await this.fs.remove(f); orphans++; }
    }
    return { temps, orphans };
  }
}

/** Preview/test backend in SQLite (dev only). Same encrypted bytes as the native files. */
export function sqlBlobBackend(db: SqlDb): BlobBackend {
  const get = async (p: string) => (await db.all<{ data: Uint8Array }>(`SELECT data FROM asset_blobs WHERE path=?`, [p]))[0]?.data ?? null;
  return {
    async create(p) { await db.run(`INSERT OR REPLACE INTO asset_blobs (path, data) VALUES (?, ?)`, [p, new Uint8Array(0) as unknown as string]); },
    async append(p, bytes) {
      const cur = (await get(p)) ?? new Uint8Array(0);
      const out = new Uint8Array(cur.length + bytes.length); out.set(cur); out.set(bytes, cur.length);
      await db.run(`UPDATE asset_blobs SET data=? WHERE path=?`, [out as unknown as string, p]);
    },
    async rename(a, b) { await db.run(`UPDATE asset_blobs SET path=? WHERE path=?`, [b, a]); },
    async source(p) { const d = await get(p); if (!d) throw new AssetError("Archivo no encontrado"); const b = new Uint8Array(d); return { size: b.length, read: async (o, l) => b.subarray(o, o + l) }; },
    async remove(p) { await db.run(`DELETE FROM asset_blobs WHERE path=?`, [p]); },
    async list(prefix) { return (await db.all<{ path: string }>(`SELECT path FROM asset_blobs WHERE path LIKE ?`, [`${prefix}%`])).map((r) => r.path); },
  };
}
