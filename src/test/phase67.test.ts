// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { branchCursor, expandSteps } from "@/lib/automation/runner";
import { flowSchema, workflows, runs, type Flow } from "@/lib/automation/store";
import { schedules } from "@/lib/automation/control";
import { workspace } from "@/lib/workspace";
import { connections } from "@/lib/connections";
import { analyzeColumn, costScenario, readTables } from "@/lib/data-analysis";
let repo: Repo;
const flow = (): Flow => ({ maxCalls: 2, steps: [{ id: "1", name: "A", tool: "chat", prompt: "", agentId: null, approval: true, contains: "", repeat: 1, next: "3", otherwise: "2" }, { id: "2", name: "B", tool: "chat", prompt: "", agentId: null, approval: true, contains: "", repeat: 1 }, { id: "3", name: "C", tool: "chat", prompt: "", agentId: null, approval: true, contains: "", repeat: 1 }] });
beforeEach(async () => { const SQL = await initSqlJs(); repo = new Repo(wrapSqlJs(new SQL.Database()), { encrypt: async (x) => "encrypted:" + x.split("").reverse().join(""), decrypt: async (x) => x.slice(10).split("").reverse().join("") }); await repo.migrate(); });
describe("Fases 6 y 7", () => {
  it("las ramas envían a destinos distintos y null termina", () => {
    const f = flow(), s = expandSteps(f.steps); expect(branchCursor(s, 0, true)).toBe(2); expect(branchCursor(s, 0, false)).toBe(1);
    const first = s[0]; if (!first) throw new Error("Fixture"); first.next = null; expect(branchCursor(s, 0, true)).toBe(3);
  });
  it("rechaza destinos inexistentes y dependencias futuras", () => {
    const f = flow(); const first = f.steps[0]; if (!first) throw new Error("Fixture"); first.next = "404"; expect(flowSchema.safeParse(f).success).toBe(false);
    first.next = "3"; first.dependsOn = ["3"]; expect(flowSchema.safeParse(f).success).toBe(false);
  });
  it("credenciales de conexión cifradas, aisladas y fuera del respaldo", async () => {
    const a = await repo.createProject("A"), b = await repo.createProject("B");
    const id = await connections.save(repo, a.id, "Linux", { host: "example.com", port: 22, user: "u", knownHosts: "example.com ssh-ed25519 AAAA" });
    await repo.saveConnectionSecret(a.id, id, "password-private");
    expect(await repo.getConnectionSecret(b.id, id)).toBeNull();
    await expect(repo.saveConnectionSecret(b.id, id, "x")).rejects.toThrow();
    const raw = await repo.sql.all<{ secret_enc: string }>("SELECT secret_enc FROM connection_secrets"); expect(raw[0]?.secret_enc).not.toContain("password-private");
    expect(JSON.stringify(await repo.dumpAll())).not.toContain("password-private");
    expect((await repo.dumpAll()).tables["connection_secrets"]).toBeUndefined();
    await repo.deleteProject(a.id); expect(await repo.sql.all("SELECT * FROM connection_secrets")).toEqual([]);
  });
  it("programación no arranca antes de fecha ni dos veces", async () => {
    const p = await repo.createProject("A"), w = await workflows.save(repo, p.id, "F", flow());
    const id = await schedules.add(repo, p.id, w, Date.now()+60000, "x");
    await expect(schedules.start(repo, p.id, id)).rejects.toThrow();
    await repo.sql.run("UPDATE schedules SET due_at=0 WHERE id=?", [id]);
    const r = await schedules.start(repo, p.id, id); expect(await runs.get(repo, p.id, r)).not.toBeNull();
    await expect(schedules.start(repo, p.id, id)).rejects.toThrow();
  });
  it("entregables y favoritos no pueden cambiar desde otro proyecto", async () => {
    const a = await repo.createProject("A"), b = await repo.createProject("B");
    await repo.sql.run("INSERT INTO workspace_items VALUES (?,?,?,'deliverable',NULL,'todo',?)", ["i", a.id, "Reporte", Date.now()]);
    await workspace.move(repo, b.id, "i", "done"); expect((await workspace.list(repo, a.id))[0]?.status).toBe("todo");
    await workspace.favorite(repo, a.id, "/code", true); expect(await workspace.favorites(repo, b.id)).toEqual([]);
    expect((await repo.dumpAll()).tables["workspace_items"]?.length).toBe(1);
  });
  it("estadísticas calculadas con valores concretos", () => {
    const s = analyzeColumn({ name: "X", headers: ["Total"], rows: [[10],[20],[30],[40],[null],["no"]] }, 0);
    expect(s).toMatchObject({ count: 4, missing: 2, sum: 100, mean: 25, median: 25, min: 10, max: 40 });
    expect(s.std).toBeCloseTo(Math.sqrt(125));
  });
  it("presupuesto determinista y punto de equilibrio", () => {
    expect(costScenario(100, 20, 8, 600)).toEqual({ revenue: 2000, costs: 1400, profit: 600, breakEven: 50 });
    expect(costScenario(100, 8, 8, 600).breakEven).toBeNull();
    expect(() => costScenario(-1, 1, 1, 1)).toThrow();
  });
  it("lee CSV real sin convertirlo en código", async () => {
    const tables = await readTables(new TextEncoder().encode("Mes,Total\nEnero,10\nFebrero,20\n"));
    const t = tables[0]; if (!t) throw new Error("Tabla"); expect(analyzeColumn(t,1).sum).toBe(30);
  });
});