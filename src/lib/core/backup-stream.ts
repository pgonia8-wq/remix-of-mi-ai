// Encrypted backup v3: written and verified piece by piece so phones with little memory never hold the whole
// archive. Format = text lines. Line 1: authenticated header (KDF + nonce prefix). Each next line: one AES-GCM
// record whose AAD binds header, record index and final flag, so reordering, truncation or splicing is rejected.
// Restore runs in two passes: (1) authenticate EVERY record without writing anything, (2) apply under a journal.
import type { Repo } from "../db/repo";
import type { KeyRing } from "./keys";
import type { BlobBackend, Asset } from "./asset-store";
import { verifyAsset } from "./asset-crypto";
import { safeAssetPath, deriveBackupKey, argonParams, PBKDF2_MIN_ITERATIONS, type Kdf } from "./backup";

const te = new TextEncoder(), td = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const BACKUP_PIECE = 256 * 1024;

type Header = { format: "miai-backup"; v: 3; kdf: Kdf; prefix: string };
type Rec =
  | { t: "table"; name: string; rows: Record<string, unknown>[] }
  | { t: "asset"; meta: Asset; dek: string }
  | { t: "piece"; id: string; data: string }
  | { t: "end"; tables: number; assets: number };

function nonce(prefix: Uint8Array, i: number) { const n = new Uint8Array(12); n.set(prefix); new DataView(n.buffer).setUint32(8, i); return n; }
const aad = (h: string, i: number, final: boolean) => te.encode(`${h}|${i}|${final ? 1 : 0}`);

/** Yields the backup as lines; the caller appends each line to the destination file. */
export async function* createBackupStream(opts: { repo: Repo; keys: KeyRing; fs: BlobBackend; password: string; kdf?: "argon2id" | "pbkdf2"; deviceMemGB?: number | null }): AsyncGenerator<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kdf: Kdf = opts.kdf === "pbkdf2" ? { alg: "pbkdf2-sha256", iterations: PBKDF2_MIN_ITERATIONS, salt: b64(salt) } : { alg: "argon2id", v: 19, ...argonParams(opts.deviceMemGB ?? null), salt: b64(salt) };
  const prefix = crypto.getRandomValues(new Uint8Array(8));
  const header: Header = { format: "miai-backup", v: 3, kdf, prefix: b64(prefix) };
  const hs = JSON.stringify(header);
  const key = await deriveBackupKey(opts.password, kdf);
  let i = 0;
  const seal = async (r: Rec) => b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(prefix, i) as BufferSource, additionalData: aad(hs, i++, r.t === "end") as BufferSource }, key, te.encode(JSON.stringify(r)) as BufferSource))) + "\n";
  yield hs + "\n";
  const dump = await opts.repo.dumpAll();
  let tables = 0, assets = 0;
  for (const [name, rows] of Object.entries(dump.tables)) {
    for (let k = 0; k < rows.length || k === 0; k += 500) { yield await seal({ t: "table", name, rows: rows.slice(k, k + 500) as Record<string, unknown>[] }); if (!rows.length) break; }
    tables++;
  }
  for (const a of (dump.tables["assets"] ?? []) as Asset[]) {
    const dek = await opts.keys.unwrapDek(a.key_id, a.wrapped_dek, a.id, a.project_id);
    const src = await opts.fs.source(a.path);
    await verifyAsset(src, { assetId: a.id, projectId: a.project_id }, dek);
    const { wrapped_dek: _w, ...meta } = a;
    yield await seal({ t: "asset", meta: meta as Asset, dek: b64(dek) }); dek.fill(0);
    for (let o = 0; o < src.size; o += BACKUP_PIECE) yield await seal({ t: "piece", id: a.id, data: b64(await src.read(o, Math.min(BACKUP_PIECE, src.size - o))) });
    assets++;
  }
  yield await seal({ t: "end", tables, assets });
}

export function isBackupV3(firstLine: string) { try { const h = JSON.parse(firstLine); return h?.format === "miai-backup" && h.v === 3; } catch { return false; } }

async function* records(lines: AsyncIterable<string> | Iterable<string>, password: string): AsyncGenerator<Rec> {
  let key: CryptoKey | null = null, hs = "", prefix = new Uint8Array(8), i = 0, ended = false;
  for await (const raw of lines as AsyncIterable<string>) {
    const line = raw.trim(); if (!line) continue;
    if (!key) {
      let h: Header; try { h = JSON.parse(line); } catch { throw new Error("Archivo de respaldo ilegible"); }
      if (h.format !== "miai-backup" || h.v !== 3) throw new Error("Formato de respaldo no reconocido");
      hs = line; prefix = unb64(h.prefix); key = await deriveBackupKey(password, h.kdf); continue;
    }
    if (ended) throw new Error("Respaldo alterado: datos después del final");
    let rec: Rec | null = null;
    for (const final of [false, true]) {
      try { rec = JSON.parse(td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce(prefix, i) as BufferSource, additionalData: aad(hs, i, final) as BufferSource }, key, unb64(line) as BufferSource))); if ((rec!.t === "end") !== final) rec = null; break; } catch { /* try other flag */ }
    }
    if (!rec) throw new Error(i === 0 ? "Contraseña incorrecta o respaldo alterado" : `Respaldo alterado en la parte ${i + 1}`);
    i++; if (rec.t === "end") ended = true;
    yield rec;
  }
  if (!key) throw new Error("Respaldo vacío");
  if (!ended) throw new Error("Respaldo incompleto o cortado: falta el cierre");
}

/** Pass 1: authenticates every record and each asset's full encrypted file, writing nothing. */
export async function verifyBackupStream(lines: () => AsyncIterable<string> | Iterable<string>, password: string) {
  let cur: { meta: Asset; dek: Uint8Array; parts: Uint8Array[] } | null = null, tables = 0, assets = 0;
  const flush = async () => { if (!cur) return; const all = concat(cur.parts); await verifyAsset({ size: all.length, read: async (o, l) => all.subarray(o, o + l) }, { assetId: cur.meta.id, projectId: cur.meta.project_id }, cur.dek); cur.dek.fill(0); cur = null; assets++; };
  for await (const r of records(lines(), password)) {
    if (r.t === "table") tables++;
    else if (r.t === "asset") { await flush(); cur = { meta: r.meta, dek: unb64(r.dek), parts: [] }; }
    else if (r.t === "piece") { if (!cur || cur.meta.id !== r.id) throw new Error("Respaldo alterado: pieza fuera de orden"); cur.parts.push(unb64(r.data)); }
    else { await flush(); if (r.assets !== assets) throw new Error("Respaldo incompleto: faltan archivos"); }
  }
  return { tables, assets };
}
function concat(parts: Uint8Array[]) { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }

/** Pass 2 under a journal. Asset files go to `.restore` temps first; rows are written last; then temps are promoted. */
export async function restoreBackupStream(opts: { lines: () => AsyncIterable<string> | Iterable<string>; password: string; repo: Repo; keys: KeyRing; fs: BlobBackend }) {
  await verifyBackupStream(opts.lines, opts.password);
  const journal = await opts.repo.journalStart("restore", { temps: [] });
  const temps: { tmp: string; path: string }[] = [];
  const tables: Record<string, Record<string, unknown>[]> = {};
  const metas: Asset[] = [];
  let cur: Asset | null = null;
  for await (const r of records(opts.lines(), opts.password)) {
    if (r.t === "table") (tables[r.name] ??= []).push(...r.rows);
    else if (r.t === "asset") {
      const dek = unb64(r.dek);
      const { keyId, wrapped } = await opts.keys.wrapDek(dek, r.meta.id, r.meta.project_id); dek.fill(0);
      cur = { ...r.meta, path: safeAssetPath(r.meta), key_id: keyId, wrapped_dek: wrapped, enc_state: "encrypted" };
      metas.push(cur);
      const tmp = `${cur.path}.restore`;
      await opts.fs.remove(tmp).catch(() => undefined); await opts.fs.create(tmp);
      temps.push({ tmp, path: cur.path });
      await opts.repo.journalSet(journal, "applied", { temps: temps.map((t) => t.tmp) }).catch(() => undefined);
    } else if (r.t === "piece" && cur) await opts.fs.append(`${cur.path}.restore`, unb64(r.data));
  }
  for (const t of temps) { await opts.fs.remove(t.path).catch(() => undefined); await opts.fs.rename(t.tmp, t.path); }
  const assetIdx = new Map(metas.map((m) => [m.id, m]));
  tables["assets"] = (tables["assets"] ?? []).map((row) => ({ ...row, ...(assetIdx.get(row["id"] as string) ?? {}) }));
  await opts.repo.restoreAll({ tables });
  await opts.repo.journalSet(journal, "committed", { temps: [] });
  return { assets: metas.length };
}

/** Startup: an interrupted restore leaves only `.restore` temps (rows are written last), so cleaning them is a safe rollback. */
export async function recoverInterruptedRestores(repo: Repo, fs: BlobBackend) {
  let n = 0;
  for (const j of await repo.journalPending()) {
    if (j.kind !== "restore") continue;
    const temps = (JSON.parse(j.detail ?? "{}")?.temps ?? []) as string[];
    for (const t of temps) await fs.remove(t).catch(() => undefined);
    await repo.journalSet(j.id, "rolled_back"); n++;
  }
  return n;
}

export function linesOf(text: string) { return text.split("\n"); }
