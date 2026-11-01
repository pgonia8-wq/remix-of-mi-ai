import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { Repo, budgetLevel } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { importRawKey, randomBytes } from "@/lib/crypto";
import { makeVault } from "@/lib/app-db";
import { AssetStore, sqlBlobBackend } from "@/lib/core/asset-store";
import { KeyRing, webBackend } from "@/lib/core/keys";
import { exportProject, importProject } from "@/lib/core/project-transfer";

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const profile = () => ({ name: "economico" as const, blockSize: 64 * 1024, concurrency: 1, reasons: [] });
async function setup() {
  SQL ??= await initSqlJs();
  const db = wrapSqlJs(new SQL.Database());
  const repo = new Repo(db, makeVault(await importRawKey(randomBytes(32))));
  await repo.migrate();
  const m = new Map<string, string>();
  const keys = new KeyRing(db, webBackend({ get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), del: (k) => void m.delete(k) }));
  return { repo, assets: new AssetStore(db, sqlBlobBackend(db), keys, profile) };
}
async function* once(b: Uint8Array) { yield b; }
const PW = "Proyecto-Seguro-2026!";

let A: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { A = await setup(); });

describe("exportar e importar un solo proyecto", () => {
  it("importa como proyecto nuevo con chats, memoria y archivos, sin tocar otros proyectos ni claves", async () => {
    const p = await A.repo.createProject("Origen");
    const other = await A.repo.createProject("Otro");
    const c = await A.repo.createChat(p.id, "Chat 1");
    await A.repo.addMessage(p.id, c.id, "user", "hola");
    await A.repo.addMemory(p.id, "hecho", "dato clave");
    const img = new Uint8Array([1, 2, 3, 4, 5]);
    await A.assets.put(p.id, once(img), { kind: "image", mime: "image/png" });
    await A.repo.saveProvider({ name: "OpenAI", kind: "openai", model: "m", apiKey: "sk-SECRETO-999" });
    const file = await exportProject({ ...A, projectId: p.id, password: PW, kdf: "pbkdf2" });
    expect(file).not.toContain("sk-SECRETO-999");

    const B = await setup(); // other device
    const { project } = await importProject({ ...B, text: file, password: PW });
    expect(project.id).not.toBe(p.id);
    const chats = await B.repo.listChats(project.id);
    expect(chats.map((x) => x.title)).toEqual(["Chat 1"]);
    expect((await B.repo.listMessages(project.id, chats[0]!.id))[0]!.content).toBe("hola");
    const list = await B.assets.list(project.id);
    expect(await B.assets.read(project.id, list[0]!.id)).toEqual(img);
    expect(await B.repo.listProviders()).toEqual([]);
    // importing twice on the same device creates a second, independent project
    const again = await importProject({ ...A, text: file, password: PW });
    expect(again.project.id).not.toBe(p.id);
    expect((await A.repo.listChats(other.id)).length).toBe(0);
  });

  it("contraseña incorrecta se rechaza sin crear ningún proyecto", async () => {
    const p = await A.repo.createProject("Origen");
    const file = await exportProject({ ...A, projectId: p.id, password: PW, kdf: "pbkdf2" });
    const B = await setup();
    await expect(importProject({ ...B, text: file, password: "otra-contraseña" })).rejects.toThrow(/incorrecta/);
    expect(await B.repo.listProjects()).toEqual([]);
  });
});

describe("presupuesto mensual por proyecto", () => {
  it("niveles: aviso al 80% y bloqueo al 100%", () => {
    expect(budgetLevel(10, 7.99).level).toBe("ok");
    expect(budgetLevel(10, 8).level).toBe("warn");
    expect(budgetLevel(10, 10).level).toBe("blocked");
    expect(budgetLevel(null, 999).level).toBe("none");
  });
  it("el gasto se cuenta solo dentro del proyecto y del mes, y marca estimados", async () => {
    const p = await A.repo.createProject("P"), q = await A.repo.createProject("Q");
    await A.repo.setProjectBudget(p.id, 10);
    const now = new Date(2026, 10, 15).getTime();
    await A.repo.recordCost(p.id, { operation: "chat", amountUsd: 7, estimated: false, at: now });
    await A.repo.recordCost(p.id, { operation: "chat", amountUsd: 50, estimated: false, at: new Date(2026, 9, 30).getTime() });
    await A.repo.recordCost(q.id, { operation: "chat", amountUsd: 50, estimated: false, at: now });
    expect((await A.repo.budgetStatus(p.id, 0, now)).level).toBe("ok");
    await A.repo.recordCost(p.id, { operation: "imagen", amountUsd: 1.5, estimated: true, at: now });
    const s = await A.repo.budgetStatus(p.id, 0, now);
    expect(s.level).toBe("warn");
    expect(s.includesEstimates).toBe(true);
    expect((await A.repo.budgetStatus(p.id, 2, now)).level).toBe("blocked");
    await expect(A.repo.setProjectBudget(p.id, 0)).rejects.toThrow();
  });
});
