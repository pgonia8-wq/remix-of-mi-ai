import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { importRawKey, randomBytes } from "@/lib/crypto";
import { makeVault } from "@/lib/app-db";
import { AssetStore, sqlBlobBackend } from "@/lib/core/asset-store";
import { KeyRing, webBackend } from "@/lib/core/keys";
import { estimateCost, budgetGate, setBudgetHooks, BudgetError } from "@/lib/core/costs";
import { createBackupStream, restoreBackupStream, verifyBackupStream, recoverInterruptedRestores, BACKUP_PIECE } from "@/lib/core/backup-stream";

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const profile = () => ({ name: "economico" as const, blockSize: 64 * 1024, concurrency: 1, reasons: [] });
async function setup() {
  SQL ??= await initSqlJs();
  const db = wrapSqlJs(new SQL.Database());
  const repo = new Repo(db, makeVault(await importRawKey(randomBytes(32))));
  await repo.migrate();
  const m = new Map<string, string>();
  const keys = new KeyRing(db, webBackend({ get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), del: (k) => void m.delete(k) }));
  const fs = sqlBlobBackend(db);
  return { db, repo, keys, fs, assets: new AssetStore(db, fs, keys, profile) };
}
async function* once(b: Uint8Array) { yield b; }
const rnd = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536))); return b; };
async function collect(g: AsyncIterable<string>) { const out: string[] = []; for await (const l of g) out.push(l); return out; }
const PW = "Copia-Segura-2026!";

let A: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { A = await setup(); setBudgetHooks({}); });

describe("costos y presupuesto", () => {
  it("sin tarifa la llamada queda 'sin precio'; con tarifa se estima por tokens, imágenes y segundos", () => {
    expect(estimateCost(null, { inputChars: 4000 })).toEqual({ amountUsd: 0, pricing: "unpriced" });
    const price = { model: "m", input_per_mtok: 2, output_per_mtok: 8, per_image: 0.04, per_second: 0.1, per_call: null, updated_at: 0 };
    expect(estimateCost(price, { inputChars: 4_000_000, outputChars: 4_000_000 }).amountUsd).toBe(10);
    expect(estimateCost(price, { images: 2, seconds: 8 }).amountUsd).toBeCloseTo(0.88);
  });
  it("al 100% se bloquea antes de enviar, salvo confirmación de esa llamada", async () => {
    const p = await A.repo.createProject("P");
    await A.repo.setProjectBudget(p.id, 1);
    await A.repo.recordCost(p.id, { operation: "chat", amountUsd: 1, estimated: true });
    await expect(budgetGate(A.repo, p.id, "m", {})).rejects.toBeInstanceOf(BudgetError);
    let asked = 0;
    setBudgetHooks({ confirmOverBudget: () => { asked++; return true; } });
    await budgetGate(A.repo, p.id, "m", {});
    expect(asked).toBe(1);
    setBudgetHooks({ confirmOverBudget: () => false });
    await expect(budgetGate(A.repo, p.id, "m", {})).rejects.toThrow(/No se envió/);
  });
  it("al 80% avisa sin bloquear", async () => {
    const p = await A.repo.createProject("P");
    await A.repo.setProjectBudget(p.id, 10);
    await A.repo.recordCost(p.id, { operation: "chat", amountUsd: 8.5, estimated: false });
    let warned = 0; setBudgetHooks({ warn: () => { warned++; } });
    await budgetGate(A.repo, p.id, "m", {});
    expect(warned).toBe(1);
  });
});

describe("respaldo por partes (v3)", () => {
  it("una restauración fallida no sustituye archivos existentes ni deja archivos promovidos", async () => {
    const p = await A.repo.createProject("P");
    const asset = await A.assets.put(p.id, once(new Uint8Array([1, 2, 3])), { kind: "text", mime: "text/plain" });
    const lines = await collect(createBackupStream({ ...A, password: PW, kdf: "pbkdf2" }));
    const paths = await A.fs.list("assets/");
    const original = A.repo.restoreAll.bind(A.repo);
    A.repo.restoreAll = async () => { throw new Error("Injected failure"); };
    try { await expect(restoreBackupStream({ ...A, lines: () => lines, password: PW })).rejects.toThrow("Injected failure"); }
    finally { A.repo.restoreAll = original; }
    expect(await A.fs.list("assets/")).toEqual(paths);
    expect(await A.assets.read(p.id, asset.id)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await A.repo.journalPending()).toEqual([]);
  });
  it("R07/R09: limpieza espera una escritura activa incluso entre dos AssetStore", async () => {
    const p = await A.repo.createProject("P");
    let release: (() => void) | undefined, started: (() => void) | undefined;
    const pause = new Promise<void>((r) => { release = r; });
    const entered = new Promise<void>((r) => { started = r; });
    const source = async function* () { started?.(); await pause; yield new Uint8Array([1, 2, 3]); };
    const write = A.assets.put(p.id, source(), { kind: "text", mime: "text/plain" });
    await entered;
    let cleaned = false;
    const other = new AssetStore(A.db, A.fs, A.keys, profile);
    const cleanup = other.cleanup().then(() => { cleaned = true; });
    await Promise.resolve(); expect(cleaned).toBe(false);
    release?.(); const asset = await write; await cleanup;
    expect(await A.assets.read(p.id, asset.id)).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("restaura en otro dispositivo un archivo grande dividido en partes; contraseña errónea se rechaza", async () => {
    const p = await A.repo.createProject("A");
    const c = await A.repo.createChat(p.id, "Hola");
    await A.repo.addMessage(p.id, c.id, "user", "mensaje");
    const data = rnd(BACKUP_PIECE * 2 + 1234);
    const a = await A.assets.put(p.id, once(data), { kind: "video", mime: "video/mp4" });
    await A.repo.saveProvider({ name: "X", kind: "openai", model: "m", apiKey: "sk-NO-EXPORTAR" });
    const lines = await collect(createBackupStream({ ...A, password: PW, kdf: "pbkdf2" }));
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.join("")).not.toContain("sk-NO-EXPORTAR");
    const B = await setup();
    await expect(restoreBackupStream({ lines: () => lines, password: "otra-mala", ...B })).rejects.toThrow(/incorrecta/);
    expect(await B.repo.listProjects()).toEqual([]);
    await restoreBackupStream({ lines: () => lines, password: PW, ...B });
    expect(await B.assets.read(p.id, a.id)).toEqual(data);
    expect((await B.repo.listMessages(p.id, c.id))[0]!.content).toBe("mensaje");
    expect((await B.repo.listProviders())[0]!.has_key).toBe(false);
  });
  it("rechaza respaldos cortados, reordenados o alterados sin escribir nada", async () => {
    const p = await A.repo.createProject("A");
    await A.assets.put(p.id, once(rnd(BACKUP_PIECE + 10)), { kind: "image", mime: "image/png" });
    const lines = await collect(createBackupStream({ ...A, password: PW, kdf: "pbkdf2" }));
    await expect(verifyBackupStream(() => lines.slice(0, -1), PW)).rejects.toThrow(/incompleto|cortado/);
    const swapped = [...lines]; [swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!];
    await expect(verifyBackupStream(() => swapped, PW)).rejects.toThrow(/alterado/);
    const B = await setup();
    await expect(restoreBackupStream({ lines: () => lines.slice(0, -1), password: PW, ...B })).rejects.toThrow();
    expect(await B.repo.listProjects()).toEqual([]);
  });
  it("una restauración interrumpida se revierte al iniciar: no quedan archivos temporales ni filas a medias", async () => {
    const id = await A.repo.journalStart("restore", { temps: [] });
    await A.fs.create("assets/x.restore"); await A.fs.append("assets/x.restore", new Uint8Array([1, 2]));
    await A.repo.journalSet(id, "applied", { temps: ["assets/x.restore"] });
    expect(await recoverInterruptedRestores(A.repo, A.fs)).toBe(1);
    expect(await A.fs.list("assets/x")).toEqual([]);
    expect(await A.repo.journalPending()).toEqual([]);
  });
});

describe("rotación de llave reanudable", () => {
  it("una rotación cortada se completa al iniciar y los archivos siguen legibles", async () => {
    const p = await A.repo.createProject("P");
    const data = rnd(5000);
    const a = await A.assets.put(p.id, once(data), { kind: "image", mime: "image/png" });
    await A.db.run(`INSERT INTO key_versions (id, status, protection, created_at) VALUES (2,'rotating','preview-insecure',0)`);
    const r = await A.keys.resumeRotation();
    expect(r?.newVersion).toBe(2);
    expect(await A.keys.current()).toBe(2);
    expect(await A.assets.read(p.id, a.id)).toEqual(data);
    expect(await A.keys.resumeRotation()).toBeNull();
  });
});
