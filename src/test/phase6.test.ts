// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { agents, workflows, runs, flowSchema, type Flow } from "@/lib/automation/store";
import { advance, interpolate, needsApproval } from "@/lib/automation/runner";
import { evaluateCode, CODE_LIMITS } from "@/lib/code/engine";
import { AssetStore, sqlBlobBackend } from "@/lib/core/asset-store";
import { KeyRing, webBackend } from "@/lib/core/keys";
import { JobManager } from "@/lib/core/jobs";
import { chooseProfile, type DeviceFacts } from "@/lib/core/device-profile";
import type { Core } from "@/lib/core";
import { validateDecision, createAdaptiveRun, advanceAdaptive } from "@/lib/automation/react";
let repo: Repo, core: Core;
const flow = (): Flow => ({ maxCalls: 2, steps: [{ id: "1", name: "Nota", tool: "note.save", prompt: "{{input}}", agentId: null, approval: false, contains: "", repeat: 1 }] });
beforeEach(async () => {
  const SQL = await initSqlJs(), db = wrapSqlJs(new SQL.Database());
  repo = new Repo(db, { encrypt: async () => "cipher", decrypt: async () => "" }); await repo.migrate();
  const mem = new Map<string, string>();
  const keys = new KeyRing(db, webBackend({ get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v); }, del: (k) => { mem.delete(k); } }));
  const device: DeviceFacts = { availMemMB: 500, totalMemMB: 3000, lowMemory: false, cores: 4, abis: [], freeStorageMB: null, batteryPct: null, charging: null, thermal: null, strongBox: false, source: "browser" };
  const profile = chooseProfile(device);
  const files = sqlBlobBackend(db), assets = new AssetStore(db, files, keys, () => profile);
  core = { repo, keys, files, assets, jobs: new JobManager(db), profile, device, startup: { temps: 0, orphans: 0, requeued: 0, interrupted: 0, needsUser: 0 } };
});
describe("Agentes y flujos", () => {
  it("decisiones adaptativas no conceden herramientas ni cambian permisos", () => {
    expect(() => validateDecision('{"kind":"tool","tool":"note.save","name":"N","input":"x"}', ["chat"])).toThrow(/permiso/);
    expect(() => validateDecision('{"kind":"tool","tool":"shell","name":"N","input":"x"}', ["chat"])).toThrow();
    expect(() => validateDecision('{"kind":"final","answer":"x","approval":false}', ["chat"])).toThrow();
  });
  it("ejecución adaptativa persiste aprobación y rechaza una autorización de otro paso", async () => {
    const p = await repo.createProject("P");
    const a = await agents.save(repo, p.id, "A", { instructions: "x", objective: "", expected: "", tools: ["chat", "note.save"], modelId: null, memory: false, maxCalls: 5 });
    const id = await createAdaptiveRun(core, p.id, a, "Objetivo", 5);
    expect((await advanceAdaptive(core, p.id, id)).status).toBe("approval");
    expect((await runs.get(repo, p.id, id))?.calls).toBe(0);
    await expect(advanceAdaptive(core, p.id, id, "action-wrong")).rejects.toThrow(/aprobación/);
    const b = await repo.createProject("B");
    await expect(advanceAdaptive(core, b.id, id)).rejects.toThrow(/ajena/);
  });
  it("no accede ni modifica agentes de otro proyecto", async () => {
    const a = await repo.createProject("A"), b = await repo.createProject("B");
    const id = await agents.save(repo, a.id, "Autor", { objective: "", instructions: "Escribe", expected: "", modelId: null, tools: ["chat"], memory: false, maxCalls: 2 });
    expect(await agents.get(repo, b.id, id)).toBeNull();
    await expect(agents.save(repo, b.id, "X", { objective: "", instructions: "x", expected: "", modelId: null, tools: ["chat"], memory: false, maxCalls: 2 }, id)).rejects.toThrow();
    const f = flow(); const first = f.steps[0]; if (!first) throw new Error("Missing fixture"); first.agentId = id;
    await expect(workflows.save(repo, b.id, "X", f)).rejects.toThrow(/ajeno/);
  });
  it("las operaciones locales requieren aprobación incluso si el plan la desactiva", async () => {
    const p = await repo.createProject("A"), w = await workflows.save(repo, p.id, "Nota", flow());
    const id = await runs.create(repo, p.id, w, "Dato privado");
    expect((await advance(core, p.id, id)).status).toBe("approval");
    expect(await repo.sql.all("SELECT * FROM notes")).toEqual([]);
    const done = await advance(core, p.id, id, true);
    expect(done.status).toBe("completed");
    expect(new TextDecoder().decode(await core.assets.read(p.id, done.output))).toBe("Dato privado");
    expect((await repo.sql.all<{ body: string }>("SELECT body FROM notes"))[0]?.body).toBe("Dato privado");
    await expect(advance(core, p.id, id, true)).rejects.toThrow();
  });
  it("prohíbe herramientas no autorizadas al agente", async () => {
    const p = await repo.createProject("A"), f = flow();
    const id = await agents.save(repo, p.id, "Autor", { objective: "", instructions: "x", expected: "", modelId: null, tools: ["chat"], memory: false, maxCalls: 2 });
    const first = f.steps[0]; if (!first) throw new Error("Missing fixture"); first.agentId = id;
    const w = await workflows.save(repo, p.id, "X", f), r = await runs.create(repo, p.id, w, "x");
    await expect(advance(core, p.id, r, true)).rejects.toThrow(/permiso/);
  });
  it("una interrupción exige confirmar y no repite acciones automáticamente", async () => {
    const p = await repo.createProject("A"), w = await workflows.save(repo, p.id, "X", flow()), id = await runs.create(repo, p.id, w, "x");
    await repo.sql.run("UPDATE workflow_runs SET status='running' WHERE id=?", [id]);
    await runs.recover(repo);
    expect((await runs.get(repo, p.id, id))?.status).toBe("recovery_required");
    await expect(advance(core, p.id, id, true)).rejects.toThrow(/Confirma/);
  });
  it("rechaza herramientas arbitrarias, repeticiones ilimitadas e ids duplicados", () => {
    expect(flowSchema.safeParse({ maxCalls: 2, steps: [{ ...flow().steps[0], tool: "shell" }] }).success).toBe(false);
    expect(flowSchema.safeParse({ maxCalls: 2, steps: [{ ...flow().steps[0], repeat: 4 }] }).success).toBe(false);
    expect(flowSchema.safeParse({ maxCalls: 2, steps: [flow().steps[0], flow().steps[0]] }).success).toBe(false);
  });
  it("respalda y borra los registros de agentes y flujos", async () => {
    const p = await repo.createProject("A"); await workflows.save(repo, p.id, "X", flow());
    expect((await repo.dumpAll()).tables["workflows"]?.length).toBe(1);
    await repo.deleteProject(p.id); expect(await workflows.list(repo, p.id)).toEqual([]);
  });
  it("variables no se evalúan como código y llamadas con coste fuerzan aprobación", () => {
    expect(interpolate("{{input}} / {{previous}}", "{{previous}}", "fin")).toBe("{{previous}} / fin");
    for (const tool of ["research.web", "image.generate", "audio.tts", "code.execute"] as const) expect(needsApproval({ ...flow().steps[0], id: "x", name: "x", prompt: "", agentId: null, contains: "", repeat: 1, tool, approval: false })).toBe(true);
  });
});
describe("Motor JavaScript aislado", () => {
  it("ejecuta JavaScript real con entrada y salida", async () => {
    expect(await evaluateCode("console.log(input); 2 + 2", "hola")).toEqual({ ok: true, output: "hola\n4" });
  });
  it("no expone red, DOM, almacenamiento, módulos ni puente Capacitor", async () => {
    const r = await evaluateCode('[typeof fetch,typeof document,typeof localStorage,typeof process,typeof require,typeof Capacitor].join(",")');
    expect(r.output).toBe("undefined,undefined,undefined,undefined,undefined,undefined");
  });
  it("interrumpe bucles infinitos", async () => {
    const r = await evaluateCode("while(true) {}", "", 30);
    expect(r.ok).toBe(false); expect(r.error).toMatch(/Tiempo/);
  });
  it("limita código, memoria y salida", async () => {
    await expect(evaluateCode("x".repeat(CODE_LIMITS.source + 1))).rejects.toThrow();
    expect((await evaluateCode("const a=[]; while(true) a.push(new Array(10000).fill('x'))", "", 300)).ok).toBe(false);
    expect((await evaluateCode("console.log('x'.repeat(20000))")).ok).toBe(false);
  });
});