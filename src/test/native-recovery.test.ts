import { expect, it } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { makeVault } from "@/lib/app-db";
import { importRawKey, randomBytes } from "@/lib/crypto";
import { checkSentinelRecovery } from "@/lib/recovery-check";

it("native recovery check deletes and restores chats, both memory versions and documents", async () => {
  const SQL = await initSqlJs();
  const repo = new Repo(wrapSqlJs(new SQL.Database()), makeVault(await importRawKey(randomBytes(32))));
  await repo.migrate();
  const project = await repo.createProject("selftest-A");
  const chat = await repo.createChat(project.id);
  await repo.addMessage(project.id, chat.id, "user", "MIAI_PLAINTEXT_PROBE_7f3a");
  await repo.addMessage(project.id, chat.id, "assistant", "answer");
  const memory = await repo.addMemory(project.id, "hipotesis", "first");
  await repo.editMemory(project.id, memory, "decision", "second");
  await repo.addDoc(project.id, { name: "doc.txt", mime: "text/plain", size: 3, text: "doc", filePath: null });
  await checkSentinelRecovery(repo, project.id);
  expect((await repo.listMessages(project.id, chat.id)).map(m => m.content)).toEqual(["MIAI_PLAINTEXT_PROBE_7f3a", "answer"]);
  expect((await repo.memoryHistory(project.id, memory)).map(m => m.content)).toEqual(["second", "first"]);
  expect((await repo.listDocs(project.id))[0]?.text_content).toBe("doc");
});