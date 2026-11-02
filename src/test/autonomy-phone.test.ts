// @vitest-environment node
// Autonomy without a PC: phone workspace, phone-mode runs, tool availability, delegation gate and ZIP delivery.
// Provider responses are scripted (no credentials, no cost) — simulation, stated as such.
import { beforeEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { AssetStore, sqlBlobBackend } from "@/lib/core/asset-store";
import { KeyRing, webBackend } from "@/lib/core/keys";
import { JobManager } from "@/lib/core/jobs";
import { chooseProfile, type DeviceFacts } from "@/lib/core/device-profile";
import type { Core } from "@/lib/core";
import { invokeTool, DEFAULT_LIMITS, type ToolCtx } from "@/lib/automation/tools";
import { createRun, stepRun, autoRuns, usableTools, type ModelCall } from "@/lib/automation/orchestrator";
import { localWs, normPath } from "@/lib/automation/local-workspace";
import { builderPlanPhone } from "@/lib/automation/builder";
import { localTestFiles } from "@/lib/automation/quality";
import { zipStore, crc32 } from "@/lib/zip";
import { CHAT_TOOLS, splitRunMarkers, runMarker } from "@/lib/chat-tools";

let repo: Repo, core: Core;
beforeEach(async () => {
  const SQL = await initSqlJs(), db = wrapSqlJs(new SQL.Database());
  repo = new Repo(db, { encrypt: async (s) => `enc:${s}`, decrypt: async (s) => s.slice(4) }); await repo.migrate();
  const mem = new Map<string, string>();
  const keys = new KeyRing(db, webBackend({ get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v); }, del: (k) => { mem.delete(k); } }));
  const device: DeviceFacts = { availMemMB: 500, totalMemMB: 3000, lowMemory: false, cores: 4, abis: [], freeStorageMB: null, batteryPct: null, charging: null, thermal: null, strongBox: false, source: "browser" };
  const profile = chooseProfile(device), files = sqlBlobBackend(db), assets = new AssetStore(db, files, keys, () => profile);
  core = { repo, keys, files, assets, jobs: new JobManager(db), profile, device, startup: { temps: 0, orphans: 0, requeued: 0, interrupted: 0, needsUser: 0 } } as Core;
});
const PC_TOOLS = ["shell.exec", "git", "dev.npm", "node.info", "repo.push", "data.sql"];

describe("Espacio de trabajo del teléfono", () => {
  it("escribe con hash, detecta conflictos, versiona y restaura", async () => {
    const p = (await repo.createProject("A")).id;
    const w1 = await localWs.write(repo, p, "src/app.js", "v1", null);
    if (w1.conflict) throw new Error("conflicto inesperado");
    expect((await localWs.write(repo, p, "src/app.js", "otra", null)).conflict).toBe(true);
    const w2 = await localWs.write(repo, p, "src/app.js", "v2", w1.hash);
    expect(w2.conflict).toBeFalsy();
    expect((await localWs.read(repo, p, "src/app.js")).text).toBe("v2");
    const [v] = await localWs.versions(repo, p, "src/app.js");
    await localWs.restore(repo, p, "src/app.js", v!.version);
    expect((await localWs.read(repo, p, "src/app.js")).text).toBe("v1");
    expect((await localWs.search(repo, p, "v1"))[0]?.path).toBe("src/app.js");
  });
  it("aísla proyectos y rechaza rutas fuera del espacio", async () => {
    const a = (await repo.createProject("A")).id, b = (await repo.createProject("B")).id;
    await localWs.write(repo, a, "secreto.txt", "solo A", null);
    expect(await localWs.list(repo, b)).toEqual([]);
    await expect(localWs.read(repo, b, "secreto.txt")).rejects.toThrow();
    for (const bad of ["../x", "/etc/passwd", "a/../../b", "C:/x"]) expect(() => normPath(bad)).toThrow();
    await repo.deleteProject(a);
    expect(await repo.sql.all("SELECT * FROM local_ws_files WHERE project_id=?", [a])).toEqual([]);
  });
});

describe("Agentes sin PC", () => {
  it("las herramientas de archivos funcionan en el teléfono sin PC Node", async () => {
    const p = (await repo.createProject("A")).id;
    const runId = await createRun(core, p, { goal: "x" });
    const ctx: ToolCtx = { core, projectId: p, runId, taskId: "t1", agent: "backend" };
    const opts = (k: string) => ({ allowed: ["fs.write", "fs.read", "fs.list"], limits: DEFAULT_LIMITS, opKey: k });
    const w = await invokeTool(ctx, "fs.write", { path: "README.md", content: "hola", baseHash: null }, opts("k1"));
    expect(w.status).toBe("ok");
    const r = await invokeTool(ctx, "fs.read", { path: "README.md" }, opts("k2"));
    expect(r.status === "ok" && r.output.endsWith("hola")).toBe(true);
  });
  it("el plan solo ofrece herramientas utilizables en el teléfono (sin PC ni delegación)", async () => {
    const p = (await repo.createProject("A")).id;
    const runId = await createRun(core, p, { goal: "x" });
    const ids = await usableTools(core, p, runId, { nodeId: null, folderId: null });
    expect(ids).toEqual(expect.arrayContaining(["fs.write", "fs.read", "doc.create", "note.save"]));
    for (const t of [...PC_TOOLS, "agents.delegate", "ssh.exec"]) expect(ids).not.toContain(t);
  });
  it("un equipo completa una ejecución en el teléfono escribiendo archivos reales", async () => {
    const p = (await repo.createProject("A")).id;
    const plan = JSON.stringify({ tasks: [{ id: "a", title: "Escribir guía", role: "documenter", deps: [], files: ["GUIA.md"], tools: ["fs.write"], contract: "GUIA.md" }], acceptance: ["Guía escrita"] });
    const write = JSON.stringify({ kind: "tool", tool: "fs.write", input: { path: "GUIA.md", content: "# Guía", baseHash: null } });
    const q: Record<string, string[]> = { architect: [plan], documenter: [write, JSON.stringify({ kind: "final", result: "GUIA.md escrita" })], auditor: [JSON.stringify({ verdict: "approve", reasons: "Archivo observado", missing: [] })] };
    const m: ModelCall = async ({ role }) => { const l = q[role]!; return { text: l.length > 1 ? l.shift()! : l[0]! }; };
    const id = await createRun(core, p, { goal: "Guía", nodeId: null, folderId: null });
    let run = await stepRun(core, p, id, m);
    for (let i = 0; i < 10 && run.status === "active"; i++) run = await stepRun(core, p, id, m);
    expect(run.status).toBe("completed");
    expect((await localWs.read(repo, p, "GUIA.md")).text).toBe("# Guía");
  });
  it("AI Builder en el teléfono no usa herramientas de PC y exige pruebas", () => {
    const plan = builderPlanPhone("script");
    const tools = plan.tasks.flatMap((t) => t.tools);
    for (const t of PC_TOOLS) expect(tools).not.toContain(t);
    expect(plan.tasks.find((t) => t.id === "tests")!.tools).toContain("quality.run");
    expect(localTestFiles(["src/a.js", "tests/a.test.js", "b.spec.js", "tests/util.js", "x.ts"])).toEqual(["tests/a.test.js", "b.spec.js", "tests/util.js"]);
  });
});

describe("Delegación desde el chat", () => {
  it("está en el chat, pide aprobación y no está disponible para agentes", async () => {
    expect(CHAT_TOOLS).toContain("agents.delegate");
    const p = (await repo.createProject("A")).id;
    const runId = await createRun(core, p, { goal: "chat", kind: "chat" });
    const asAgent = await invokeTool({ core, projectId: p, runId, taskId: "t", agent: "backend" }, "agents.delegate", { goal: "hacer algo" }, { allowed: ["agents.delegate"], limits: DEFAULT_LIMITS, opKey: "d1" });
    expect(asAgent.status).toBe("rejected");
  });
  it("los marcadores de ejecución se separan del texto", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const r = splitRunMarkers(`Listo.\n\n${runMarker(id)}`);
    expect(r).toEqual({ text: "Listo.", runIds: [id] });
  });
});

describe("ZIP de entrega", () => {
  it("genera un ZIP válido con CRC correcto", () => {
    const data = new TextEncoder().encode("hola");
    const z = zipStore([{ path: "a.txt", data }]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint32(14, true)).toBe(crc32(data));
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50);
  });
});
