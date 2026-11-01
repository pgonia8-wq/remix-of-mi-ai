// Master-key ring with versions. Data keys (DEKs) are wrapped by the current master key.
// Native: the master key is generated INSIDE Android Keystore (non-exportable, StrongBox when available)
// by the MiaiKeystore plugin; wrapping happens in the Keystore. Preview/tests: WebCrypto key held in a
// provided store (NOT secure; development only).
import type { SqlDb } from "../db/sql";

export type Protection = "strongbox" | "tee" | "secure-hardware" | "software" | "preview-insecure" | "secure-storage";
export type KeyInfo = { version: number; protection: Protection; strongBoxAvailable: boolean | null; strongBoxUsed: boolean; note?: string };

export interface MasterKeyBackend {
  ensure(version: number): Promise<KeyInfo>;
  wrap(version: number, data: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  unwrap(version: number, wrapped: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  destroy(version: number): Promise<void>;
}

const b64 = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const te = new TextEncoder();

/** WebCrypto backend: raw key bytes in a string store (preview localStorage or test memory). */
export function webBackend(store: { get(k: string): string | null; set(k: string, v: string): void; del(k: string): void }): MasterKeyBackend {
  const cache = new Map<number, CryptoKey>();
  const key = async (v: number) => {
    let k = cache.get(v);
    if (k) return k;
    let raw = store.get(`miai_master_v${v}`);
    if (!raw) { raw = b64(crypto.getRandomValues(new Uint8Array(32))); store.set(`miai_master_v${v}`, raw); }
    k = await crypto.subtle.importKey("raw", unb64(raw) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
    cache.set(v, k);
    return k;
  };
  return {
    async ensure(v) { await key(v); return { version: v, protection: "preview-insecure", strongBoxAvailable: null, strongBoxUsed: false, note: "Vista de desarrollo: la llave no está en Android Keystore." }; },
    async wrap(v, data, aad) {
      const iv = crypto.getRandomValues(new Uint8Array(12)); // master key wraps few, short items; random 96-bit IV is standard here
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource }, await key(v), data as BufferSource));
      const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
    },
    async unwrap(v, w, aad) {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: w.subarray(0, 12) as BufferSource, additionalData: aad as BufferSource }, await key(v), w.subarray(12) as BufferSource));
    },
    async destroy(v) { cache.delete(v); store.del(`miai_master_v${v}`); },
  };
}

type NativePlugin = {
  ensureKey(o: { version: number }): Promise<{ securityLevel: string; strongBoxAvailable: boolean; strongBoxUsed: boolean }>;
  wrap(o: { version: number; data: string; aad: string }): Promise<{ data: string }>;
  unwrap(o: { version: number; data: string; aad: string }): Promise<{ data: string }>;
  deleteKey(o: { version: number }): Promise<void>;
};

/** Android Keystore backend through the MiaiKeystore Capacitor plugin. */
export function nativeBackend(plugin: NativePlugin): MasterKeyBackend {
  return {
    async ensure(version) {
      const r = await plugin.ensureKey({ version });
      const protection: Protection = r.securityLevel === "strongbox" ? "strongbox" : r.securityLevel === "tee" ? "tee" : r.securityLevel === "secure-hardware" ? "secure-hardware" : "software";
      return { version, protection, strongBoxAvailable: r.strongBoxAvailable, strongBoxUsed: r.strongBoxUsed };
    },
    async wrap(version, data, aad) { return unb64((await plugin.wrap({ version, data: b64(data), aad: b64(aad) })).data); },
    async unwrap(version, data, aad) { return unb64((await plugin.unwrap({ version, data: b64(data), aad: b64(aad) })).data); },
    async destroy(version) { await plugin.deleteKey({ version }); },
  };
}

export class KeyRing {
  constructor(private db: SqlDb, private backend: MasterKeyBackend) {}

  async current(): Promise<number> {
    const [r] = await this.db.all<{ id: number }>(`SELECT id FROM key_versions WHERE status='active' ORDER BY id DESC LIMIT 1`);
    if (r) return r.id;
    // Crash between "retire old" and "activate new": finish the pending rotation instead of recreating version 1.
    const [rot] = await this.db.all<{ id: number }>(`SELECT id FROM key_versions WHERE status='rotating' ORDER BY id DESC LIMIT 1`);
    if (rot) { await this.db.run(`UPDATE key_versions SET status='active' WHERE id=?`, [rot.id]); return rot.id; }
    const [any] = await this.db.all<{ id: number }>(`SELECT id FROM key_versions ORDER BY id DESC LIMIT 1`);
    if (any) throw new Error("No hay una llave maestra activa; se detuvo para no crear una nueva sobre datos existentes.");
    const info = await this.backend.ensure(1);
    await this.db.run(`INSERT OR IGNORE INTO key_versions (id, status, protection, created_at) VALUES (1,'active',?,?)`, [info.protection, Date.now()]);
    return 1;
  }
  async info(): Promise<KeyInfo> { return this.backend.ensure(await this.current()); }
  versions() { return this.db.all<{ id: number; status: string; protection: string; created_at: number }>(`SELECT * FROM key_versions ORDER BY id`); }

  static aad(assetId: string, projectId: string) { return te.encode(`miai-dek|${assetId}|${projectId}`); }

  async wrapDek(dek: Uint8Array, assetId: string, projectId: string): Promise<{ keyId: number; wrapped: string }> {
    const v = await this.current();
    return { keyId: v, wrapped: b64(await this.backend.wrap(v, dek, KeyRing.aad(assetId, projectId))) };
  }
  async unwrapDek(keyId: number, wrapped: string, assetId: string, projectId: string): Promise<Uint8Array> {
    try { return await this.backend.unwrap(keyId, unb64(wrapped), KeyRing.aad(assetId, projectId)); }
    catch { throw new Error("No se pudo descifrar la llave del archivo (llave inexistente o datos alterados)"); }
  }

  /**
   * Rotation: create version n+1, then re-wrap each asset's DEK (files are NOT re-encrypted).
   * Interruptible: each asset row is updated atomically; re-running continues with rows still on old versions.
   * Old versions are retired only when no asset depends on them.
   */
  async rotate(): Promise<{ newVersion: number; rewrapped: number; retired: number[] }> {
    const cur = await this.current();
    const [pending] = await this.db.all<{ id: number }>(`SELECT id FROM key_versions WHERE status='rotating' ORDER BY id DESC LIMIT 1`);
    const next = pending?.id ?? cur + 1;
    if (!pending) {
      const info = await this.backend.ensure(next);
      await this.db.run(`INSERT INTO key_versions (id, status, protection, created_at) VALUES (?,?,?,?)`, [next, "rotating", info.protection, Date.now()]);
    }
    return this.finishRotation(next);
  }
  /** Called at startup: a rotation interrupted by a crash is completed, never left half-applied. */
  async resumeRotation() {
    const [pending] = await this.db.all<{ id: number }>(`SELECT id FROM key_versions WHERE status='rotating' ORDER BY id DESC LIMIT 1`);
    return pending ? this.finishRotation(pending.id) : null;
  }
  async finishRotation(next: number) {
    const rows = await this.db.all<{ id: string; project_id: string; key_id: number; wrapped_dek: string }>(`SELECT id, project_id, key_id, wrapped_dek FROM assets WHERE key_id<>?`, [next]);
    let n = 0;
    for (const r of rows) {
      const dek = await this.unwrapDek(r.key_id, r.wrapped_dek, r.id, r.project_id);
      const w = b64(await this.backend.wrap(next, dek, KeyRing.aad(r.id, r.project_id)));
      dek.fill(0);
      await this.db.run(`UPDATE assets SET key_id=?, wrapped_dek=? WHERE id=? AND key_id=?`, [next, w, r.id, r.key_id]);
      n++;
    }
    await this.db.run(`UPDATE key_versions SET status='retired' WHERE id<>? AND status IN ('active','rotating')`, [next]);
    await this.db.run(`UPDATE key_versions SET status='active' WHERE id=?`, [next]);
    const retired: number[] = [];
    for (const v of await this.db.all<{ id: number }>(`SELECT id FROM key_versions WHERE status='retired'`)) {
      const [{ c }] = (await this.db.all<{ c: number }>(`SELECT COUNT(*) AS c FROM assets WHERE key_id=?`, [v.id])) as [{ c: number }];
      if (c === 0) { await this.backend.destroy(v.id); await this.db.run(`UPDATE key_versions SET status='destroyed' WHERE id=?`, [v.id]); retired.push(v.id); }
    }
    return { newVersion: next, rewrapped: n, retired };
  }
}
