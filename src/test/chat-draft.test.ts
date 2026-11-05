import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { Repo, IsolationError } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { importRawKey, randomBytes } from "@/lib/crypto";
import { makeVault } from "@/lib/app-db";
import { createDraftSaver } from "@/lib/chat-draft";

let repo: Repo;
beforeEach(async () => {
  const SQL = await initSqlJs();
  repo = new Repo(wrapSqlJs(new SQL.Database()), makeVault(await importRawKey(randomBytes(32))));
  await repo.migrate();
});

describe("respuesta guardada mientras el modelo escribe", () => {
  it("una respuesta cortada a mitad queda guardada y marcada como interrumpida", async () => {
    const p = await repo.createProject("A"), chat = await repo.createChat(p.id);
    let t = 0;
    const saver = createDraftSaver({
      now: () => t,
      create: async (text) => { const m = await repo.addMessage(p.id, chat.id, "assistant", text); await repo.setMessageStatus(p.id, chat.id, m.id, "streaming"); return m.id; },
      update: (id, text) => repo.updateMessage(p.id, id, text),
    });
    saver.push("Hola");
    t = 500; saver.push("Hola, esto es"); // throttled
    t = 2000; saver.push("Hola, esto es una respuesta larga");
    t = 2100; saver.push("Hola, esto es una respuesta larga que se corta", true); // screen locked
    await saver.settle();
    // The app is killed here: on reopening, the half-written answer is there and becomes "interrupted".
    const msgs = await repo.listMessages(p.id, chat.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("Hola, esto es una respuesta larga que se corta");
    expect(await repo.interruptStaleMessages(p.id, chat.id)).toBe(1);
    expect(await repo.listMessageStatus(p.id, chat.id)).toEqual([{ message_id: msgs[0]!.id, status: "interrupted" }]);
  });

  it("no marca como interrumpida una respuesta que se sigue escribiendo", async () => {
    const p = await repo.createProject("A"), chat = await repo.createChat(p.id);
    const m = await repo.addMessage(p.id, chat.id, "assistant", "parcial");
    await repo.setMessageStatus(p.id, chat.id, m.id, "streaming");
    expect(await repo.interruptStaleMessages(p.id, chat.id, [m.id])).toBe(0);
  });

  it("continuar añade al mismo mensaje sin crear otro", async () => {
    const p = await repo.createProject("A"), chat = await repo.createChat(p.id);
    const m = await repo.addMessage(p.id, chat.id, "assistant", "Primera parte");
    const saver = createDraftSaver({ initialId: m.id, create: async () => { throw new Error("no debe crear"); }, update: (id, text) => repo.updateMessage(p.id, id, text) });
    saver.push("Primera parte y segunda parte", true);
    await saver.settle();
    const msgs = await repo.listMessages(p.id, chat.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("Primera parte y segunda parte");
  });

  it("el estado de un mensaje no se puede tocar desde otro proyecto", async () => {
    const a = await repo.createProject("A"), b = await repo.createProject("B"), chat = await repo.createChat(a.id);
    const m = await repo.addMessage(a.id, chat.id, "assistant", "x");
    await expect(repo.setMessageStatus(b.id, chat.id, m.id, "interrupted")).rejects.toBeInstanceOf(IsolationError);
    await repo.setMessageStatus(a.id, chat.id, m.id, "streaming");
    expect(await repo.listMessageStatus(b.id, chat.id)).toEqual([]);
  });
});
