/**
 * MI AI encrypted asset format v1 (same on every device; only block size / concurrency adapt).
 *
 *   "MIAIAST1" | u32 headerLen | headerJSON | record* | finalRecord
 *   record = u32 len | AES-256-GCM(ciphertext ‖ 16-byte tag)
 *
 * - One fresh random 256-bit data key (DEK) per write. Never reused across writes, so (key, nonce) never repeats.
 * - Nonce (96 bit) = 32-bit random per-file prefix ‖ 64-bit big-endian block counter (deterministic, monotonic).
 *   Data blocks use counters 0..n-1 (< FINAL_COUNTER). The final record uses the reserved counter 2^64-1.
 * - AAD = SHA-256(header bytes) ‖ "assetId|projectId|formatVersion|dekId|index|isFinal".
 *   The header is therefore authenticated by every record, including the final record of an empty file.
 * - The final record encrypts {blocks, size, tagsHash} where tagsHash = SHA-256 over every data tag in order:
 *   missing, reordered, duplicated or truncated blocks are detected. Without a valid final record the file is incomplete.
 */
import { createSHA256 } from "hash-wasm";
export const MAGIC = new TextEncoder().encode("MIAIAST1");
export const FORMAT_VERSION = 1;
const FINAL_COUNTER = 0xffffffffffffffffn;
const MAX_HEADER = 64 * 1024;
const MAX_BLOCKS = 2 ** 32; // far below the counter space; enforced
const TAG = 16;

export class AssetIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "AssetIntegrityError"; }
}

export type AssetHeader = { fmt: "miai-asset"; v: number; assetId: string; projectId: string; dekId: string; blockSize: number; prefix: string };
export type AssetContext = { assetId: string; projectId: string };
export type ByteSource = { size: number; read(offset: number, length: number): Promise<Uint8Array> };

const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function u32(n: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; }
function readU32(b: Uint8Array) { return new DataView(b.buffer, b.byteOffset, 4).getUint32(0); }
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function nonce(prefix: Uint8Array, counter: bigint): Uint8Array {
  if (prefix.length !== 4) throw new Error("prefijo de nonce inválido");
  const n = new Uint8Array(12);
  n.set(prefix, 0);
  new DataView(n.buffer).setBigUint64(4, counter);
  return n;
}
async function sha256(data: Uint8Array) { return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource)); }
function aad(headerHash: Uint8Array, h: AssetHeader, index: bigint, final: boolean) {
  return concat(headerHash, te.encode(`${h.assetId}|${h.projectId}|${h.v}|${h.dekId}|${index}|${final ? 1 : 0}`));
}

export async function importDek(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("La llave de datos debe ser de 256 bits");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export function newDek(): Uint8Array { return crypto.getRandomValues(new Uint8Array(32)); }

export type EncryptOptions = { blockSize: number; concurrency?: number; dekId?: string; prefix?: Uint8Array };

/** Re-chunks any input into fixed-size plaintext blocks without holding more than one block in memory. */
async function* blocks(src: AsyncIterable<Uint8Array>, size: number): AsyncGenerator<Uint8Array> {
  let buf = new Uint8Array(size), fill = 0;
  for await (const chunk of src) {
    let off = 0;
    while (off < chunk.length) {
      const n = Math.min(size - fill, chunk.length - off);
      buf.set(chunk.subarray(off, off + n), fill); fill += n; off += n;
      if (fill === size) { yield buf; buf = new Uint8Array(size); fill = 0; }
    }
  }
  if (fill > 0) yield buf.subarray(0, fill);
}

/**
 * Streams the encrypted file. Blocks may be encrypted in parallel (bounded by `concurrency`)
 * but are always emitted strictly in order; nonces come from the block index, never from timing.
 */
export async function* encryptAsset(src: AsyncIterable<Uint8Array>, ctx: AssetContext, dekRaw: Uint8Array, opts: EncryptOptions): AsyncGenerator<Uint8Array, { blocks: number; size: number }> {
  if (!Number.isInteger(opts.blockSize) || opts.blockSize < 4096 || opts.blockSize > 64 * 1024 * 1024) throw new Error("Tamaño de bloque fuera de límites");
  const key = await importDek(dekRaw);
  const prefix = opts.prefix ?? crypto.getRandomValues(new Uint8Array(4));
  const header: AssetHeader = { fmt: "miai-asset", v: FORMAT_VERSION, assetId: ctx.assetId, projectId: ctx.projectId, dekId: opts.dekId ?? crypto.randomUUID(), blockSize: opts.blockSize, prefix: b64(prefix) };
  const hb = te.encode(JSON.stringify(header));
  const hh = await sha256(hb);
  yield concat(MAGIC, u32(hb.length), hb);

  const conc = Math.max(1, Math.min(8, opts.concurrency ?? 1));
  const tagHash = await createSHA256(); tagHash.init();
  let index = 0n, size = 0;
  const seal = async (pt: Uint8Array, i: bigint) =>
    new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(prefix, i) as BufferSource, additionalData: aad(hh, header, i, false) as BufferSource, tagLength: 128 }, key, pt as BufferSource));
  let window: { i: bigint; p: Promise<Uint8Array> }[] = [];
  const flush = async function* () {
    for (const w of window) { const ct = await w.p; tagHash.update(ct.subarray(ct.length - TAG)); yield concat(u32(ct.length), ct); }
    window = [];
  };
  for await (const pt of blocks(src, opts.blockSize)) {
    if (index >= BigInt(MAX_BLOCKS)) throw new Error("Límite de bloques excedido");
    size += pt.length;
    window.push({ i: index, p: seal(pt, index) });
    index++;
    if (window.length >= conc) yield* flush();
  }
  yield* flush();
  const total = Number(index);
  const fin = te.encode(JSON.stringify({ blocks: total, size, tagsHash: b64(tagHash.digest("binary")) }));
  const fct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(prefix, FINAL_COUNTER) as BufferSource, additionalData: aad(hh, header, FINAL_COUNTER, true) as BufferSource, tagLength: 128 }, key, fin as BufferSource));
  yield concat(u32(fct.length), fct);
  return { blocks: total, size };
}

async function parseHeader(src: ByteSource, ctx: AssetContext) {
  if (src.size < MAGIC.length + 4) throw new AssetIntegrityError("Archivo incompleto: sin encabezado");
  const pre = await src.read(0, MAGIC.length + 4);
  for (let i = 0; i < MAGIC.length; i++) if (pre[i] !== MAGIC[i]) throw new AssetIntegrityError("Formato de archivo no reconocido");
  const hl = readU32(pre.subarray(MAGIC.length));
  if (hl <= 0 || hl > MAX_HEADER || MAGIC.length + 4 + hl > src.size) throw new AssetIntegrityError("Encabezado inválido");
  const hb = await src.read(MAGIC.length + 4, hl);
  let header: AssetHeader;
  try { header = JSON.parse(td.decode(hb)); } catch { throw new AssetIntegrityError("Encabezado ilegible"); }
  if (header.fmt !== "miai-asset" || header.v !== FORMAT_VERSION) throw new AssetIntegrityError("Versión de formato no admitida");
  // Cheap early rejection; the cryptographic binding is the AAD, checked on every record.
  if (header.assetId !== ctx.assetId || header.projectId !== ctx.projectId) throw new AssetIntegrityError("El archivo no corresponde a este activo o proyecto");
  const prefix = unb64(header.prefix);
  if (prefix.length !== 4) throw new AssetIntegrityError("Prefijo de nonce inválido");
  return { header, hh: await sha256(hb), prefix, start: MAGIC.length + 4 + hl };
}

/** Scans record boundaries. The last record must be the final record. */
async function recordTable(src: ByteSource, start: number, blockSize: number) {
  const recs: { off: number; len: number }[] = [];
  let off = start;
  while (off < src.size) {
    if (off + 4 > src.size) throw new AssetIntegrityError("Archivo truncado");
    const len = readU32(await src.read(off, 4));
    if (len < TAG || len > blockSize + TAG || off + 4 + len > src.size) throw new AssetIntegrityError("Registro con longitud inválida");
    recs.push({ off: off + 4, len });
    off += 4 + len;
  }
  if (!recs.length) throw new AssetIntegrityError("Archivo incompleto: falta el registro final");
  return recs;
}

/** Internal provisional decoder. Never expose its output to a caller before full verification. */
async function* decryptProvisional(src: ByteSource, ctx: AssetContext, dekRaw: Uint8Array): AsyncGenerator<Uint8Array, { blocks: number; size: number }> {
  const key = await importDek(dekRaw);
  const { header, hh, prefix, start } = await parseHeader(src, ctx);
  const tagHash = await createSHA256(); tagHash.init();
  let size = 0, off = start, blocks = 0, previousSize = header.blockSize;
  let finalCipher: Uint8Array | null = null;
  while (off < src.size) {
    if (off + 4 > src.size) throw new AssetIntegrityError("Archivo truncado");
    const len = readU32(await src.read(off, 4));
    if (len < TAG || len > header.blockSize + TAG || off + 4 + len > src.size) throw new AssetIntegrityError("Registro con longitud inválida");
    const ct = await src.read(off + 4, len);
    off += 4 + len;
    if (off === src.size) { finalCipher = ct; break; }
    if (previousSize !== header.blockSize || blocks >= MAX_BLOCKS) throw new AssetIntegrityError("Tamaño o cantidad de bloques inconsistente");
    const i = blocks;
    let pt: Uint8Array;
    try {
      pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce(prefix, BigInt(i)) as BufferSource, additionalData: aad(hh, header, BigInt(i), false) as BufferSource, tagLength: 128 }, key, ct as BufferSource));
    } catch { throw new AssetIntegrityError(`Bloque ${i} alterado, fuera de orden o con llave incorrecta`); }
    previousSize = pt.length;
    tagHash.update(ct.subarray(ct.length - TAG));
    blocks++;
    size += pt.length;
    yield pt;
  }
  let fin: { blocks: number; size: number; tagsHash: string };
  try {
    if (!finalCipher) throw new AssetIntegrityError("Registro final ausente");
    const fct = finalCipher;
    fin = JSON.parse(td.decode(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce(prefix, FINAL_COUNTER) as BufferSource, additionalData: aad(hh, header, FINAL_COUNTER, true) as BufferSource, tagLength: 128 }, key, fct as BufferSource))));
  } catch { throw new AssetIntegrityError("Registro final ausente o alterado: archivo incompleto"); }
  if (fin.blocks !== blocks || fin.size !== size || fin.tagsHash !== b64(tagHash.digest("binary"))) throw new AssetIntegrityError("El registro final no coincide: bloques eliminados, duplicados o reordenados");
  return { blocks, size };
}

/** Full verification without keeping plaintext. */
export async function verifyAsset(src: ByteSource, ctx: AssetContext, dekRaw: Uint8Array) {
  const it = decryptProvisional(src, ctx, dekRaw);
  for (;;) { const r = await it.next(); if (r.done) return r.value; }
}

/** Authenticate the complete file before yielding any plaintext. Two bounded-memory passes;
 * digests pin each read to the verified snapshot, rejecting a source changed between passes.
 */
export async function* decryptAsset(src: ByteSource, ctx: AssetContext, dekRaw: Uint8Array): AsyncGenerator<Uint8Array, { blocks: number; size: number }> {
  const size = src.size;
  const digests = new Map<string, Uint8Array>();
  const snapshot: ByteSource = { size, async read(offset, length) {
    const bytes = (await src.read(offset, length)).slice();
    if (bytes.length !== length || src.size !== size) throw new AssetIntegrityError("Archivo cambiado o truncado durante la verificación");
    digests.set(`${offset}:${length}`, await sha256(bytes));
    return bytes;
  } };
  await verifyAsset(snapshot, ctx, dekRaw);
  const pinned: ByteSource = { size, async read(offset, length) {
    const bytes = (await src.read(offset, length)).slice();
    const expected = digests.get(`${offset}:${length}`);
    const actual = await sha256(bytes);
    if (src.size !== size || bytes.length !== length || !expected || actual.some((value, index) => value !== expected[index])) throw new AssetIntegrityError("El archivo cambió después de verificarlo");
    return bytes;
  } };
  return yield* decryptProvisional(pinned, ctx, dekRaw);
}

/** Returns plaintext only after the whole file verified. Intended for small/medium assets (display, export). */
export async function readAll(src: ByteSource, ctx: AssetContext, dekRaw: Uint8Array): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const p of decryptProvisional(src, ctx, dekRaw)) parts.push(p);
  return concat(...parts);
}

export function memorySource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (o, l) => bytes.subarray(o, o + l) };
}
export async function collect(it: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const p of it) parts.push(p);
  return concat(...parts);
}
export async function* fromBytes(b: Uint8Array, chunk = 256 * 1024) {
  for (let i = 0; i < b.length; i += chunk) yield b.subarray(i, i + chunk);
}
