import { describe, it, expect } from "vitest";
import { encryptAsset, decryptAsset, readAll, verifyAsset, collect, fromBytes, memorySource, nonce, newDek, AssetIntegrityError, MAGIC } from "@/lib/core/asset-crypto";

const ctx = { assetId: "asset-1", projectId: "proj-A" };
const BS = 4096;
const rand = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536))); return b; };

async function enc(data: Uint8Array, dek = newDek(), conc = 1, prefix?: Uint8Array) {
  const file = await collect(encryptAsset(fromBytes(data, 1000), ctx, dek, { blockSize: BS, concurrency: conc, ...(prefix ? { prefix, dekId: "fixed" } : {}) }));
  return { file, dek };
}
/** Splits a file into header part and records [lenPrefix+ct]. */
function split(file: Uint8Array) {
  const dv = new DataView(file.buffer, file.byteOffset);
  const hl = dv.getUint32(MAGIC.length);
  const start = MAGIC.length + 4 + hl;
  const recs: Uint8Array[] = [];
  let off = start;
  while (off < file.length) { const l = dv.getUint32(off); recs.push(file.slice(off, off + 4 + l)); off += 4 + l; }
  return { head: file.slice(0, start), recs };
}
const join = (head: Uint8Array, recs: Uint8Array[]) => { const parts = [head, ...recs]; const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const rejects = (f: Uint8Array, dek: Uint8Array, c = ctx) => expect(verifyAsset(memorySource(f), c, dek)).rejects.toBeInstanceOf(AssetIntegrityError);

describe("formato cifrado de activos (AES-256-GCM por bloques)", () => {
  for (const [name, size] of [["vacío", 0], ["pequeño", 10], ["exacto a un bloque", BS], ["mediano", BS * 5 + 123], ["grande (2 MiB)", 2 * 1024 * 1024 + 7]] as const) {
    it(`cifra y descifra un archivo ${name}`, async () => {
      const data = rand(size);
      const { file, dek } = await enc(data);
      expect(await readAll(memorySource(file), ctx, dek)).toEqual(data);
    });
  }

  it("la concurrencia no altera el resultado ni el orden", async () => {
    const data = rand(BS * 9 + 5), dek = newDek(), prefix = new Uint8Array([1, 2, 3, 4]);
    const a = await enc(data, dek, 1, prefix), b = await enc(data, dek, 4, prefix);
    expect(b.file).toEqual(a.file);
  });

  it("imagen PNG y audio MP3 se recuperan byte a byte", async () => {
    for (const sig of [[0x89, 0x50, 0x4e, 0x47], [0x49, 0x44, 0x33, 0x04]]) {
      const data = new Uint8Array([...sig, ...rand(BS * 2)]);
      const { file, dek } = await enc(data);
      expect(await readAll(memorySource(file), ctx, dek)).toEqual(data);
    }
  });

  it("nonces únicos: prefijo por archivo + contador; nunca se repiten dentro de un archivo", () => {
    const p = new Uint8Array([9, 9, 9, 9]);
    const seen = new Set<string>();
    for (let i = 0n; i < 5000n; i++) seen.add(nonce(p, i).join(","));
    seen.add(nonce(p, 0xffffffffffffffffn).join(","));
    expect(seen.size).toBe(5001);
    expect(() => nonce(new Uint8Array(3), 0n)).toThrow();
  });

  it("cada escritura usa una llave de datos nueva", () => {
    expect(newDek()).not.toEqual(newDek());
    expect(newDek().length).toBe(32);
  });

  it("rechaza un byte alterado en un bloque", async () => {
    const { file, dek } = await enc(rand(BS * 3));
    const bad = file.slice(); bad[bad.length - 200]! ^= 1;
    await rejects(bad, dek);
  });

  it("rechaza etiqueta GCM incorrecta", async () => {
    const { file, dek } = await enc(rand(BS * 2));
    const { head, recs } = split(file);
    const r = recs[0]!.slice(); r[r.length - 1]! ^= 0xff;
    await rejects(join(head, [r, ...recs.slice(1)]), dek);
  });

  it("rechaza bloques reordenados", async () => {
    const { file, dek } = await enc(rand(BS * 3));
    const { head, recs } = split(file);
    await rejects(join(head, [recs[1]!, recs[0]!, ...recs.slice(2)]), dek);
  });

  it("rechaza bloques duplicados", async () => {
    const { file, dek } = await enc(rand(BS * 3));
    const { head, recs } = split(file);
    await rejects(join(head, [recs[0]!, recs[0]!, ...recs.slice(1)]), dek);
  });

  it("rechaza bloques eliminados", async () => {
    const { file, dek } = await enc(rand(BS * 3));
    const { head, recs } = split(file);
    await rejects(join(head, [recs[0]!, ...recs.slice(2)]), dek);
  });

  it("rechaza archivo sin registro final (truncado), incluso vacío", async () => {
    for (const size of [BS * 3, 0]) {
      const { file, dek } = await enc(rand(size));
      const { head, recs } = split(file);
      await rejects(join(head, recs.slice(0, -1)), dek);
    }
  });

  it("rechaza encabezado alterado (también en archivo vacío)", async () => {
    for (const size of [BS, 0]) {
      const { file, dek } = await enc(rand(size));
      const { head, recs } = split(file);
      const txt = new TextDecoder().decode(head.slice(MAGIC.length + 4));
      const forged = txt.replace(/"blockSize":\d+/, `"blockSize":${BS + 0}`).replace(/"prefix":"[^"]+"/, `"prefix":"AAAAAA=="`);
      const hb = new TextEncoder().encode(forged);
      const nh = new Uint8Array(MAGIC.length + 4 + hb.length); nh.set(MAGIC); new DataView(nh.buffer).setUint32(MAGIC.length, hb.length); nh.set(hb, MAGIC.length + 4);
      await rejects(join(nh, recs), dek);
    }
  });

  it("rechaza archivo de otro activo o proyecto y llave incorrecta", async () => {
    const { file, dek } = await enc(rand(100));
    await rejects(file, dek, { assetId: "asset-1", projectId: "proj-B" });
    await rejects(file, dek, { assetId: "otro", projectId: "proj-A" });
    await rejects(file, newDek());
  });

  it("no entrega el archivo como válido cuando falla a mitad de lectura", async () => {
    const data = rand(BS * 4);
    const { file, dek } = await enc(data);
    const { head, recs } = split(file);
    const bad = join(head, [recs[0]!, recs[1]!, recs[3]!, recs[4]!]); // block 2 missing
    const got: Uint8Array[] = [];
    let completed = false;
    try { for await (const p of decryptAsset(memorySource(bad), ctx, dek)) got.push(p); completed = true; } catch (e) { expect(e).toBeInstanceOf(AssetIntegrityError); }
    expect(completed).toBe(false);
    await expect(readAll(memorySource(bad), ctx, dek)).rejects.toBeInstanceOf(AssetIntegrityError);
  });

  it("interrupción durante la escritura: un archivo parcial nunca verifica", async () => {
    const data = rand(BS * 5);
    const dek = newDek();
    const parts: Uint8Array[] = [];
    let n = 0;
    for await (const p of encryptAsset(fromBytes(data), ctx, dek, { blockSize: BS })) { parts.push(p); if (++n === 3) break; }
    await rejects(join(parts[0]!, parts.slice(1)), dek);
  });

  it("límites del tamaño de bloque", async () => {
    await expect(collect(encryptAsset(fromBytes(new Uint8Array(1)), ctx, newDek(), { blockSize: 100 }))).rejects.toThrow();
  });
});
