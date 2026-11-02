// @vitest-environment node
// Chat/phone tools: every chat tool is registered, file tools and engines really run on the phone workspace
// (7-Zip WASM, sql.js, diff, hashes, CAD), and gates (approvals, roles, https-only) hold. No provider is called.
import { beforeEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { AssetStore, sqlBlobBackend } from "@/lib/core/asset-store";
import { KeyRing, webBackend } from "@/lib/core/keys";
import { JobManager } from "@/lib/core/jobs";
import { chooseProfile, type DeviceFacts } from "@/lib/core/device-profile";
import type { Core } from "@/lib/core";
import { invokeTool, getTool, DEFAULT_LIMITS, type ToolCtx } from "@/lib/automation/tools";
import { createRun } from "@/lib/automation/orchestrator";
import { localWs } from "@/lib/automation/local-workspace";
import { applyEdits, indexSymbols } from "@/lib/automation/phone-tools";
import { createArchive, extractArchive } from "@/lib/archive";
import { CHAT_TOOLS } from "@/lib/chat-tools";

let repo: Repo, core: Core, p: string, ctx: ToolCtx;
const opts = (op: string) => ({ allowed: [...CHAT_TOOLS], limits: { ...DEFAULT_LIMITS, maxCalls: 300, perAgentCalls: 300, unknownCost: "allow" as const }, opKey: op });
let n = 0;
const call = (tool: string, input: unknown) => invokeTool(ctx, tool, input, opts(`t${n++}`));
const okOut = async (tool: string, input: unknown) => { const r = await call(tool, input); if (r.status !== "ok") throw new Error(`${tool}: ${JSON.stringify(r)}`); return r; };

beforeEach(async () => {
  const SQL = await initSqlJs(), db = wrapSqlJs(new SQL.Database());
  repo = new Repo(db, { encrypt: async (s) => `enc:${s}`, decrypt: async (s) => s.slice(4) }); await repo.migrate();
  const mem = new Map<string, string>();
  const keys = new KeyRing(db, webBackend({ get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v); }, del: (k) => { mem.delete(k); } }));
  const device: DeviceFacts = { availMemMB: 500, totalMemMB: 3000, lowMemory: false, cores: 4, abis: [], freeStorageMB: null, batteryPct: null, charging: null, thermal: null, strongBox: false, source: "browser" };
  const profile = chooseProfile(device), files = sqlBlobBackend(db), assets = new AssetStore(db, files, keys, () => profile);
  core = { repo, keys, files, assets, jobs: new JobManager(db), profile, device, startup: { temps: 0, orphans: 0, requeued: 0, interrupted: 0, needsUser: 0 } } as Core;
  p = (await repo.createProject("A")).id;
  const runId = await createRun(core, p, { goal: "chat", kind: "chat", limits: { maxCalls: 300 } });
  ctx = { core, projectId: p, runId, taskId: null, agent: "chat" };
});

describe("Herramientas del chat", () => {
  it("todas las herramientas del chat existen en el registro y tienen implementación", () => {
    expect(CHAT_TOOLS.length).toBeGreaterThanOrEqual(70);
    for (const id of CHAT_TOOLS) { const t = getTool(id); expect(t, id).toBeTruthy(); expect(t!.run, id).toBeTruthy(); }
  });
  it("el chat escribe, parchea, mueve, indexa y compara archivos en el teléfono", async () => {
    await okOut("fs.write", { path: "src/app.ts", content: "export function suma(a: number, b: number) { return a + b; }\nconst x = suma(1, 2);\n", baseHash: null });
    await okOut("fs.patch", { path: "src/app.ts", edits: [{ find: "return a + b;", replace: "return a + b + 0;" }] });
    expect((await localWs.read(repo, p, "src/app.ts")).text).toContain("a + b + 0");
    await okOut("fs.move", { from: "src/app.ts", to: "lib/app.ts", copy: true });
    await okOut("fs.move", { from: "lib/app.ts", to: "lib/main.ts" });
    expect((await localWs.list(repo, p)).map((f) => f.path).sort()).toEqual(["lib/main.ts", "src/app.ts"]);
    const refs = JSON.parse((await okOut("code.refs", { symbol: "suma" })).output);
    expect(refs.definitions.length).toBe(2); expect(refs.references.length).toBe(4);
    expect((await okOut("text.diff", { aPath: "src/app.ts", bPath: "lib/main.ts" })).output).toContain("src/app.ts");
  });
  it("un parche ambiguo o inexistente no modifica el archivo", () => {
    expect(() => applyEdits("a a", [{ find: "a", replace: "b" }])).toThrow(/2 veces/);
    expect(() => applyEdits("abc", [{ find: "zzz", replace: "b" }])).toThrow(/no se encontró/);
    expect(applyEdits("a a", [{ find: "a", replace: "b", all: true }])).toBe("b b");
  });
  it("indexa símbolos de Python y TypeScript", () => {
    expect(indexSymbols("m.py", "class Gato:\n  def maullar(self):\n    pass").map((s) => s.name)).toEqual(["Gato", "maullar"]);
    expect(indexSymbols("m.ts", "interface A {}\ntype B = 1;\nexport const c = 2;").map((s) => s.kind)).toEqual(["interfaz", "tipo", "variable"]);
  });
  it("crea y extrae ZIP, 7z y TAR.GZ con 7-Zip WASM", async () => {
    const enc = new TextEncoder();
    for (const format of ["zip", "7z", "tar.gz"] as const) {
      const bytes = await createArchive([{ path: "a.txt", data: enc.encode("hola") }, { path: "d/b.txt", data: enc.encode("mundo") }], format);
      const out = await extractArchive(bytes, `x.${format}`);
      const files = format === "tar.gz" ? await extractArchive(out[0]!.data, "x.tar") : out;
      expect(files.map((e) => `${e.path}=${new TextDecoder().decode(e.data)}`).sort(), format).toEqual(["a.txt=hola", "d/b.txt=mundo"]);
    }
  }, 60_000);
  it("archive.create + archive.extract pasan por el chat y la biblioteca cifrada", async () => {
    await localWs.write(repo, p, "x/uno.txt", "1", null);
    const r = await okOut("archive.create", { format: "7z", name: "paquete", all: true });
    const id = r.assets![0]!.id;
    await okOut("archive.extract", { assetId: id, into: "copia" });
    expect((await localWs.read(repo, p, "copia/x/uno.txt")).text).toBe("1");
  }, 60_000);
  it("base de datos local: crea, inserta, consulta y conserva la versión anterior", async () => {
    await okOut("db.sql", { db: "tienda", sql: "CREATE TABLE p (n TEXT, v REAL); INSERT INTO p VALUES ('a', 2), ('b', 3);", write: true });
    const q = await okOut("db.sql", { db: "tienda", sql: "SELECT SUM(v) s FROM p" });
    expect(JSON.parse(q.output.split(" Filas")[0]!)[0].rows[0][0]).toBe(5);
    const bad = await call("db.sql", { db: "tienda", sql: "DELETE FROM p" });
    expect(bad.status).toBe("rejected");
    await okOut("db.sql", { db: "tienda", sql: "DELETE FROM p", write: true });
    expect(Object.values(JSON.parse((await okOut("db.list", {})).output) as Record<string, { versions: number }>)[0]!.versions).toBe(2);
  });
  it("las peticiones HTTP piden aprobación y solo aceptan https públicas", async () => {
    expect((await call("http.request", { method: "POST", url: "https://api.example.com/x", headers: {} })).status).toBe("approval");
    const local = await call("web.fetch", { url: "http://192.168.1.1/admin" });
    expect(local.status).toBe("rejected");
  });
  it("hash, fechas, finanzas, CAD y gráficas producen resultados reales", async () => {
    expect((await okOut("hash.compute", { text: "abc", algo: "sha256" })).output).toContain("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect((await okOut("hash.compute", { text: "abc", algo: "md5" })).output).toContain("900150983cd24fb0d6963f7d28e17f72");
    expect(JSON.parse((await okOut("datetime.now", {})).output).epochMs).toBeGreaterThan(0);
    expect(JSON.parse((await okOut("calc.finance", { kind: "npv", rate: 10, cashflows: [-100, 110] })).output).npv).toBeCloseTo(0, 5);
    const cad = await okOut("cad.create", { doc: { version: 1, unit: "mm", name: "caja", features: [{ id: "a", kind: "box", size: [10, 10, 10] }] }, format: "stl" });
    expect(cad.output).toContain("1000.0 mm³");
    expect((await okOut("chart.create", { title: "Ventas", type: "bar", labels: ["a", "b"], values: [1, 2] })).assets![0]!.mime).toBe("image/svg+xml");
  });
  it("restaurar un punto de restauración requiere aprobación; pc.exec solo es para el chat y exige PC", async () => {
    await localWs.write(repo, p, "a.txt", "v1", null);
    const snap = await okOut("ws.snapshot", { label: "antes" });
    const id = /restauración ([0-9a-f-]{36})/.exec(snap.output)![1]!;
    expect((await call("ws.restore", { assetId: id })).status).toBe("approval");
    const pc = await call("pc.exec", { argv: ["bash", "-lc", "ls"] });
    expect(pc.status).toBe("rejected");
    const agent = await invokeTool({ ...ctx, agent: "backend" }, "pc.exec", { argv: ["ls"] }, opts("x1"));
    expect(agent.status === "rejected" && agent.reason).toMatch(/rol/);
  });
});
