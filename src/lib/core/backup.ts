// Encrypted backup v2: portable across devices. Keystore keys are NOT transferable, so each asset's DEK is
// carried inside the payload, which is sealed with a key derived from the backup password (Argon2id preferred,
// PBKDF2-HMAC-SHA256 fallback). The password and derived key are never stored or logged.
import { argon2id } from "hash-wasm";
import type { Repo } from "../db/repo";
import type { SqlDb } from "../db/sql";
import type { KeyRing } from "./keys";
import type { BlobBackend, Asset } from "./asset-store";
import { verifyAsset, memorySource } from "./asset-crypto";

export type Kdf =
  | { alg: "argon2id"; v: 19; memKiB: number; iterations: number; parallelism: number; salt: string }
  | { alg: "pbkdf2-sha256"; iterations: number; salt: string };

const te = new TextEncoder(), td = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const ARGON_LIMITS = { minMemKiB: 19 * 1024, maxMemKiB: 256 * 1024, minIterations: 2, maxIterations: 10 };
export const PBKDF2_MIN_ITERATIONS = 600_000;

/** Argon2id parameters adapted to device memory, clamped to documented safe bounds (OWASP minimum 19 MiB, t=2). */
export function argonParams(deviceMemGB: number | null): { memKiB: number; iterations: number; parallelism: number } {
  if (deviceMemGB !== null && deviceMemGB >= 4) return { memKiB: 64 * 1024, iterations: 3, parallelism: 1 };
  return { memKiB: ARGON_LIMITS.minMemKiB, iterations: 2, parallelism: 1 };
}

export async function deriveBackupKey(password: string, kdf: Kdf): Promise<CryptoKey> {
  const salt = unb64(kdf.salt);
  if (salt.length < 16 || salt.length > 64) throw new Error("Sal fuera de límites");
  // Hostile files must not force unbounded work: strict upper bounds for every KDF field.
  if (kdf.alg === "argon2id" && (kdf.v !== 19 || !Number.isInteger(kdf.parallelism) || kdf.parallelism < 1 || kdf.parallelism > 4)) throw new Error("Parámetros Argon2id no admitidos");
  if (kdf.alg === "pbkdf2-sha256" && (!Number.isInteger(kdf.iterations) || kdf.iterations > 5_000_000)) throw new Error("Iteraciones PBKDF2 fuera de límites");
  if (kdf.alg !== "argon2id" && kdf.alg !== "pbkdf2-sha256") throw new Error("KDF no admitida");
  let raw: Uint8Array;
  if (kdf.alg === "argon2id") {
    if (kdf.memKiB < ARGON_LIMITS.minMemKiB || kdf.memKiB > ARGON_LIMITS.maxMemKiB || kdf.iterations < ARGON_LIMITS.minIterations || kdf.iterations > ARGON_LIMITS.maxIterations) throw new Error("Parámetros Argon2id fuera de límites seguros");
    raw = (await argon2id({ password, salt, parallelism: kdf.parallelism, iterations: kdf.iterations, memorySize: kdf.memKiB, hashLength: 32, outputType: "binary" })) as Uint8Array;
  } else {
    if (kdf.iterations < PBKDF2_MIN_ITERATIONS) throw new Error("Iteraciones PBKDF2 insuficientes");
    const base = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
    raw = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: kdf.iterations }, base, 256));
  }
  const key = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return key;
}

export function passwordStrength(pw: string): { ok: boolean; hint: string } {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 14 && classes >= 3) return { ok: true, hint: "Contraseña robusta" };
  if (pw.length >= 10) return { ok: true, hint: "Aceptable; recomendamos 14+ caracteres con mayúsculas, números y símbolos" };
  return { ok: false, hint: "Usa al menos 10 caracteres (recomendado 14+)" };
}

type Payload = {
  dump: Awaited<ReturnType<Repo["dumpAll"]>>;
  deks: Record<string, string>; // assetId -> raw DEK (b64), protected by the outer AES-GCM
  blobs: Record<string, string>; // assetId -> encrypted file bytes (b64, still DEK-encrypted)
};
export type BackupFile = { format: "miai-backup"; v: 2; kdf: Kdf; iv: string; data: string };

export async function createBackup(opts: { repo: Repo; keys: KeyRing; fs: BlobBackend; password: string; kdf?: "argon2id" | "pbkdf2"; deviceMemGB?: number | null }): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kdf: Kdf = opts.kdf === "pbkdf2"
    ? { alg: "pbkdf2-sha256", iterations: PBKDF2_MIN_ITERATIONS, salt: b64(salt) }
    : { alg: "argon2id", v: 19, ...argonParams(opts.deviceMemGB ?? null), salt: b64(salt) };
  const dump = await opts.repo.dumpAll();
  const deks: Record<string, string> = {}, blobs: Record<string, string> = {};
  for (const a of (dump.tables["assets"] ?? []) as Asset[]) {
    const dek = await opts.keys.unwrapDek(a.key_id, a.wrapped_dek, a.id, a.project_id);
    const src = await opts.fs.source(a.path);
    await verifyAsset(src, { assetId: a.id, projectId: a.project_id }, dek); // never back up a corrupt asset silently
    deks[a.id] = b64(dek); dek.fill(0);
    blobs[a.id] = b64(await src.read(0, src.size));
    delete (a as Partial<Asset>).wrapped_dek; // device-specific; re-created on restore
  }
  const key = await deriveBackupKey(opts.password, kdf);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = { format: "miai-backup", v: 2, kdf } as const;
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: te.encode(JSON.stringify(header)) as BufferSource }, key, te.encode(JSON.stringify({ dump, deks, blobs } satisfies Payload)) as BufferSource));
  return JSON.stringify({ ...header, iv: b64(iv), data: b64(ct) } satisfies BackupFile);
}

/** Step 1-4: verify authenticity (GCM over header+payload) and recover DEKs. Wrong password → rejected, nothing touched. */
export async function openBackup(text: string, password: string): Promise<Payload> {
  let f: BackupFile;
  try { f = JSON.parse(text); } catch { throw new Error("Archivo de respaldo ilegible"); }
  if (f.format !== "miai-backup" || f.v !== 2) throw new Error("Formato de respaldo no reconocido");
  const key = await deriveBackupKey(password, f.kdf);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(f.iv) as BufferSource, additionalData: te.encode(JSON.stringify({ format: f.format, v: f.v, kdf: f.kdf })) as BufferSource }, key, unb64(f.data) as BufferSource);
    return JSON.parse(td.decode(pt));
  } catch { throw new Error("Contraseña incorrecta o respaldo alterado"); }
}

/**
 * Steps 5-8 on the (possibly new) device: re-wrap each DEK with THIS device's Keystore master key, write files,
 * verify every asset, then restore rows. Idempotent (INSERT OR REPLACE / overwrite): an interrupted restore can be
 * re-run with the same untouched backup file. API keys are not included and must be re-entered and re-tested.
 */
/** Paths are never taken from the file: they are regenerated from validated IDs (confined to assets/<project>/). */
export function safeAssetPath(a: { id: unknown; project_id: unknown }) {
  const ok = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
  if (!ok(a.id) || !ok(a.project_id)) throw new Error("Respaldo con identificadores de archivo no válidos");
  return `assets/${a.project_id}/${a.id}.miai`;
}

export async function restoreBackup(opts: { payload: Payload; repo: Repo; db: SqlDb; keys: KeyRing; fs: BlobBackend }): Promise<{ assets: number }> {
  const { payload } = opts;
  const assets = (payload.dump.tables["assets"] ?? []) as Asset[];
  for (const a of assets) {
    const dek = unb64(payload.deks[a.id] ?? "");
    const bytes = unb64(payload.blobs[a.id] ?? "");
    await verifyAsset(memorySource(bytes), { assetId: a.id, projectId: a.project_id }, dek);
    const { keyId, wrapped } = await opts.keys.wrapDek(dek, a.id, a.project_id);
    dek.fill(0);
    a.key_id = keyId; a.wrapped_dek = wrapped; a.enc_state = "encrypted";
    a.path = safeAssetPath(a);
    const tmp = `${a.path}.restore`;
    await opts.fs.remove(tmp).catch(() => undefined);
    await opts.fs.create(tmp);
    await opts.fs.append(tmp, bytes);
    await opts.fs.remove(a.path).catch(() => undefined);
    await opts.fs.rename(tmp, a.path);
  }
  await opts.repo.restoreAll(payload.dump as { tables: Record<string, Record<string, unknown>[]> });
  return { assets: assets.length };
}
