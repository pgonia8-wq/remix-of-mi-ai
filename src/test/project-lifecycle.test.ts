import { it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { importRawKey, randomBytes } from "@/lib/crypto";
import { makeVault } from "@/lib/app-db";
let repo: Repo;
beforeEach(async () => { const SQL = await initSqlJs(); repo = new Repo(wrapSqlJs(new SQL.Database()), makeVault(await importRawKey(randomBytes(32)))); await repo.migrate(); });
it("archiva y desarchiva un proyecto sin borrar datos", async () => {
  const a = await repo.createProject("A"); await repo.setProjectArchived(a.id, true);
  expect(await repo.isProjectArchived(a.id)).toBe(true);
  expect(await repo.listArchivedProjectIds()).toEqual([a.id]);
  await repo.setProjectArchived(a.id, false); expect(await repo.isProjectArchived(a.id)).toBe(false);
});
it("duplica chats, mensajes y memoria en un proyecto nuevo e independiente", async () => {
  const a = await repo.createProject("A"); const c = await repo.createChat(a.id);
  await repo.addMessage(a.id, c.id, "user", "hola"); await repo.addMemory(a.id, "hecho", "dato");
  const b = await repo.duplicateProject(a.id);
  expect(b.name).toBe("A (copia)");
  const chats = await repo.listChats(b.id); expect(chats).toHaveLength(1);
  expect((await repo.listMessages(b.id, chats[0].id)).map((m) => m.content)).toEqual(["hola"]);
  expect((await repo.listMemory(b.id)).map((m) => m.content)).toEqual(["dato"]);
  await repo.deleteProject(a.id); expect(await repo.listChats(b.id)).toHaveLength(1);
});
