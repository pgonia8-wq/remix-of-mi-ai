import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { importRawKey, randomBytes } from "@/lib/crypto";
import { makeVault } from "@/lib/app-db";

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
const fresh = async () => { const r = new Repo(wrapSqlJs(new SQL.Database()), makeVault(await importRawKey(randomBytes(32)))); await r.migrate(); return r; };
let repo: Repo;
beforeEach(async () => { SQL = await initSqlJs(); repo = await fresh(); });

describe("auditoría: respaldos y duplicados no pierden datos", () => {
  it("restaurar un respaldo conserva contexto 80 y estado interrumpido", async () => {
    const p = await repo.createProject("A"), c = await repo.createChat(p.id);
    const m = await repo.addMessage(p.id, c.id, "assistant", "medio");
    await repo.setChatContextLimit(p.id, c.id, 80);
    await repo.setMessageStatus(p.id, c.id, m.id, "interrupted");
    const dump = JSON.parse(JSON.stringify(await repo.dumpAll()));
    const other = await fresh();
    await other.restoreAll(dump);
    expect(await other.getChatContextLimit(p.id, c.id)).toBe(80);
    expect(await other.listMessageStatus(p.id, c.id)).toEqual([{ message_id: m.id, status: "interrupted" }]);
  });

  it("duplicar conserva contexto y estado", async () => {
    const p = await repo.createProject("A"), c = await repo.createChat(p.id);
    const m = await repo.addMessage(p.id, c.id, "assistant", "medio");
    await repo.setChatContextLimit(p.id, c.id, 80);
    await repo.setMessageStatus(p.id, c.id, m.id, "interrupted");
    const copy = await repo.duplicateProject(p.id);
    const [nc] = await repo.listChats(copy.id);
    expect(await repo.getChatContextLimit(copy.id, nc.id)).toBe(80);
    expect((await repo.listMessageStatus(copy.id, nc.id))[0]?.status).toBe("interrupted");
  });

  it("si duplicar falla a mitad no queda una copia parcial", async () => {
    const p = await repo.createProject("A"), c = await repo.createChat(p.id);
    await repo.addMessage(p.id, c.id, "user", "uno");
    await repo.addMessage(p.id, c.id, "user", "dos");
    const orig = repo.sql.run.bind(repo.sql);
    let n = 0;
    (repo.sql as { run: typeof orig }).run = async (q: string, a?: unknown[]) => { if (q.startsWith("INSERT INTO messages") && ++n === 2) throw new Error("fallo simulado"); return orig(q, a as never); };
    await expect(repo.duplicateProject(p.id)).rejects.toThrow("fallo simulado");
    (repo.sql as { run: typeof orig }).run = orig;
    expect((await repo.listProjects()).length).toBe(1);
  });
});

describe("auditoría: enlaces y preferencias", () => {
  it("un video terminado se adjunta al mensaje que lo pidió", async () => {
    const p = await repo.createProject("A"), c = await repo.createChat(p.id);
    const m = await repo.addMessage(p.id, c.id, "assistant", "creando video");
    const t = Date.now();
    await repo.sql.run("INSERT INTO jobs (id, project_id, capability_id, idempotency_key, phase, status, created_at, updated_at) VALUES ('j1',?,'video.generate','k1','accepted','processing',?,?)", [p.id, t, t]);
    expect(await repo.linkJobsToMessage(p.id, c.id, m.id, t - 1)).toBe(1);
    await repo.sql.run("INSERT INTO assets (id, project_id, kind, mime, size, path, key_id, wrapped_dek, enc_state, created_at) VALUES ('a1',?,'video','video/mp4',1,'p',1,'w','sealed',?)", [p.id, t]);
    expect((await repo.attachFinishedJob(p.id, "j1", ["a1"]))?.message_id).toBe(m.id);
  });

  it("las preferencias del equipo autónomo quedan en su proyecto", async () => {
    const a = await repo.createProject("A"), b = await repo.createProject("B");
    await repo.setAutonomyPrefs(a.id, { folderId: null, nodeId: null, sshId: "s1", modelId: "m1", roleChoices: { coordinator: "m1" } });
    expect((await repo.getAutonomyPrefs(a.id))?.sshId).toBe("s1");
    expect(await repo.getAutonomyPrefs(b.id)).toBeNull();
  });
});
