// Single-project export/import. The file is sealed with a password-derived key (same KDF as backup v2).
// Import always creates a NEW project with fresh IDs, so it can never merge into or overwrite another project.
// Wrong password / tampering is rejected before anything is written; a failure mid-import removes the partial project.
// API keys, connection secrets and verification claims are never included.
import type { Repo } from "../db/repo";
import type { AssetStore, Asset } from "./asset-store";
import { deriveBackupKey, argonParams, PBKDF2_MIN_ITERATIONS, type Kdf } from "./backup";

const te = new TextEncoder(), td = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

type Row = Record<string, string | number | null>;
const TABLES = ["chats", "messages", "memory_items", "memory_versions", "documents", "notes", "tasks"] as const;
type ProjectPayload = { project: { name: string; description: string | null }; tables: Record<string, Row[]>; assets: { meta: Asset; data: string }[] };
export type ProjectFile = { format: "miai-project"; v: 1; kdf: Kdf; iv: string; data: string };

export async function exportProject(opts: { repo: Repo; assets: AssetStore; projectId: string; password: string; kdf?: "argon2id" | "pbkdf2"; deviceMemGB?: number | null }): Promise<string> {
  const p = await opts.repo.getProject(opts.projectId);
  if (!p) throw new Error("Proyecto inexistente");
  const db = opts.repo.sql;
  const tables: Record<string, Row[]> = {};
  for (const t of TABLES) tables[t] = await db.all<Row>(`SELECT * FROM ${t} WHERE project_id=?`, [p.id]);
  const assetRows = await db.all<Asset>(`SELECT * FROM assets WHERE project_id=? ORDER BY version, created_at`, [p.id]);
  const assets: ProjectPayload["assets"] = [];
  for (const a of assetRows) {
    const bytes = await opts.assets.read(p.id, a.id); // authenticated full read
    const { wrapped_dek: _w, key_id: _k, ...meta } = a;
    assets.push({ meta: meta as Asset, data: b64(bytes) });
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kdf: Kdf = opts.kdf === "pbkdf2"
    ? { alg: "pbkdf2-sha256", iterations: PBKDF2_MIN_ITERATIONS, salt: b64(salt) }
    : { alg: "argon2id", v: 19, ...argonParams(opts.deviceMemGB ?? null), salt: b64(salt) };
  const key = await deriveBackupKey(opts.password, kdf);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = { format: "miai-project", v: 1, kdf } as const;
  const payload: ProjectPayload = { project: { name: p.name, description: p.description }, tables, assets };
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: te.encode(JSON.stringify(header)) as BufferSource }, key, te.encode(JSON.stringify(payload)) as BufferSource));
  return JSON.stringify({ ...header, iv: b64(iv), data: b64(ct) } satisfies ProjectFile);
}

async function openProject(text: string, password: string): Promise<ProjectPayload> {
  let f: ProjectFile;
  try { f = JSON.parse(text); } catch { throw new Error("Archivo de proyecto ilegible"); }
  if (f?.format !== "miai-project" || f.v !== 1) throw new Error("No es un archivo de proyecto de MI AI");
  const key = await deriveBackupKey(password, f.kdf);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(f.iv) as BufferSource, additionalData: te.encode(JSON.stringify({ format: f.format, v: f.v, kdf: f.kdf })) as BufferSource }, key, unb64(f.data) as BufferSource);
    return JSON.parse(td.decode(pt));
  } catch { throw new Error("Contraseña incorrecta o archivo alterado"); }
}

export async function importProject(opts: { repo: Repo; assets: AssetStore; text: string; password: string }) {
  const payload = await openProject(opts.text, opts.password); // nothing is written before this succeeds
  const { repo } = opts;
  const db = repo.sql;
  const created = await repo.createProject(payload.project.name, payload.project.description ?? "");
  const ids = new Map<string, string>();
  const map = (old: unknown) => { if (typeof old !== "string") return old as null; let n = ids.get(old); if (!n) { n = crypto.randomUUID(); ids.set(old, n); } return n; };
  const REFS: Record<string, string[]> = { messages: ["chat_id"], memory_versions: ["item_id"] };
  try {
    for (const t of TABLES) {
      for (const row of payload.tables[t] ?? []) {
        const r: Row = { ...row, id: map(row["id"]), project_id: created.id };
        for (const c of REFS[t] ?? []) r[c] = map(row[c]);
        const cols = Object.keys(r);
        await db.run(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, cols.map((c) => r[c] ?? null));
      }
    }
    let assetsCount = 0;
    for (const { meta, data } of payload.assets) {
      const bytes = unb64(data);
      async function* once() { yield bytes; }
      const parent = meta.parent_id ? ids.get(meta.parent_id) ?? null : null;
      const a = await opts.assets.put(created.id, once(), { kind: meta.kind, mime: meta.mime, format: meta.format, name: meta.name, prompt: meta.prompt, params: meta.params ? JSON.parse(meta.params) : null, parentId: parent });
      ids.set(meta.id, a.id);
      assetsCount++;
    }
    return { project: created, assets: assetsCount };
  } catch (e) {
    for (const a of await opts.assets.list(created.id).catch(() => [])) await opts.assets.remove(created.id, a.id).catch(() => undefined);
    await repo.deleteProject(created.id);
    throw e;
  }
}

// ---------- Bluetooth packaging ----------
// Android's Bluetooth receiver rejects unknown file types on many phones, so a project or model setup sent by
// Bluetooth travels inside a plain ZIP ("Nombre.miaiproj.zip"). The content stays sealed with its password.
export const BLUETOOTH_MIME = "application/zip";
const safeBase = (n: string) => n.replace(/[^\w-]+/g, "_") || "proyecto";
export function bluetoothName(baseName: string, ext = ".miaiproj") { return `${safeBase(baseName)}${ext}.zip`; }
export async function packForBluetooth(text: string, baseName: string, ext = ".miaiproj"): Promise<Uint8Array> {
  const { zipStore } = await import("../zip");
  return zipStore([{ path: `${safeBase(baseName)}${ext}`, data: te.encode(text) }]);
}
/** Reads a received file: the plain sealed text or the Bluetooth ZIP that contains it. */
export async function unpackReceived(bytes: Uint8Array, ext: string, label: string): Promise<string> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const { unzipSync } = await import("fflate");
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((n) => n.toLowerCase().endsWith(ext));
    if (!name) throw new Error(`El ZIP no contiene ${label} de MI AI (${ext}).`);
    return td.decode(files[name]!);
  }
  return td.decode(bytes);
}
export const projectFileText = (bytes: Uint8Array) => unpackReceived(bytes, ".miaiproj", "un proyecto");
export const isProjectFileName = (n: string) => /\.miaiproj(\.zip)?$/i.test(n);
export async function fileBytes(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []; let n = 0;
  for await (const c of chunks) { parts.push(c.slice()); n += c.length; }
  const all = new Uint8Array(n); let o = 0; for (const c of parts) { all.set(c, o); o += c.length; }
  return all;
}
