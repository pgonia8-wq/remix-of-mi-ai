// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { streamChat } from "@/lib/providers";
import { attachmentKind } from "@/lib/chat-attachments";
let repo: Repo;
beforeEach(async () => { const SQL = await initSqlJs(); repo = new Repo(wrapSqlJs(new SQL.Database()), { encrypt: async () => "encrypted", decrypt: async () => "" }); await repo.migrate(); });
afterEach(() => vi.unstubAllGlobals());
describe("Adjuntos y acciones del chat", () => {
  it("un archivo y su texto nunca se enlazan a mensajes de otro proyecto", async () => {
    const a = await repo.createProject("A"), b = await repo.createProject("B"), ca = await repo.createChat(a.id), cb = await repo.createChat(b.id);
    const ma = await repo.addMessage(a.id, ca.id, "user", "Archivo"), mb = await repo.addMessage(b.id, cb.id, "user", "Otro");
    await repo.sql.run("INSERT INTO assets (id,project_id,kind,mime,size,path,key_id,wrapped_dek,enc_state,version,name,created_at) VALUES ('asset',?,'document','text/plain',10,'x',1,'x','encrypted',1,'a.txt',1)", [a.id]);
    await expect(repo.attachToMessage(b.id, cb.id, mb.id, "asset", "secreto")).rejects.toThrow(/ajeno/);
    await repo.attachToMessage(a.id, ca.id, ma.id, "asset", "secreto");
    expect(await repo.listChatAttachments(b.id, cb.id)).toEqual([]);
    expect((await repo.listChatAttachments(a.id, ca.id))[0]?.text_content).toBe("secreto");
    expect((await repo.dumpAll()).tables["chat_attachments"]).toHaveLength(1);
  });
  it("valoraciones permanecen aisladas y se eliminan con la conversación", async () => {
    const a = await repo.createProject("A"), b = await repo.createProject("B"), ca = await repo.createChat(a.id);
    const m = await repo.addMessage(a.id, ca.id, "assistant", "Hola");
    await repo.setMessageFeedback(a.id, m.id, "like");
    await expect(repo.setMessageFeedback(b.id, m.id, "dislike")).rejects.toThrow(/ajeno/);
    expect(await repo.messageFeedback(a.id, ca.id)).toEqual([{ message_id: m.id, value: "like" }]);
    await repo.deleteChat(a.id, ca.id); expect(await repo.messageFeedback(a.id, ca.id)).toEqual([]);
  });
  it.each(["openai", "azure_openai", "anthropic", "gemini"] as const)("%s envía la imagen en su formato nativo", async (kind) => {
    const data = kind === "anthropic" ? { type: "content_block_delta", delta: { text: "OK" } } : kind === "gemini" ? { candidates: [{ content: { parts: [{ text: "OK" }] } }] } : { choices: [{ delta: { content: "OK" } }] };
    const fetcher = vi.fn(async () => new Response(`data: ${JSON.stringify(data)}\n\n`)); vi.stubGlobal("fetch", fetcher);
    await streamChat({ kind, endpoint: kind === "azure_openai" ? "https://r.services.ai.azure.com/openai/v1/chat/completions" : null, model: "vision", deployment: "vision", apiKey: "test-key" }, [{ role: "user", content: "Imagen", images: [{ mime: "image/png", data: "aGVsbG8=" }] }], () => {});
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; const body = JSON.parse(String(init.body));
    if (kind === "gemini") expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: "image/png", data: "aGVsbG8=" });
    else if (kind === "anthropic") expect(body.messages[0].content[1].source).toEqual({ type: "base64", media_type: "image/png", data: "aGVsbG8=" });
    else expect(body.messages[0].content[1].image_url.url).toBe("data:image/png;base64,aGVsbG8=");
  });
  it("rechaza archivos no analizables sin fingir lectura", () => { expect(attachmentKind("a.png", "image/png")).toBe("image"); expect(attachmentKind("a.docx", "")).toBe("document"); expect(() => attachmentKind("a.exe", "application/octet-stream")).toThrow(); });
});
describe("per-chat context messages (not a message quota)", () => {
  const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `${i}` }));
  it("sends the last N messages, starting on a user turn", async () => {
    const { fitHistory } = await import("@/lib/chat-attachments");
    const sent = fitHistory(turns(1500), 20);
    expect(sent.at(-1)!.content).toBe("1499"); expect(sent[0]!.role).toBe("user"); expect(sent.length).toBeLessThanOrEqual(20);
  });
  it("0 = unlimited sends all 1500 messages", async () => {
    const { fitHistory } = await import("@/lib/chat-attachments");
    expect(fitHistory(turns(1500), 0)).toHaveLength(1500);
  });
  it("drops images from older turns but keeps them on the latest", async () => {
    const { fitHistory } = await import("@/lib/chat-attachments");
    const img = { mime: "image/png", data: "a" };
    const sent = fitHistory([{ role: "user", content: "old", images: [img] }, { role: "assistant", content: "ok" }, { role: "user", content: "new", images: [img] }], 0);
    expect(sent[0]!.images).toBeUndefined(); expect(sent[2]!.images).toHaveLength(1);
  });
  it("detects provider context overflow so the user is told to lower it", async () => {
    const { isContextOverflow } = await import("@/lib/chat-attachments");
    expect(isContextOverflow(400, '{"error":{"code":"context_length_exceeded"}}')).toBe(true);
    expect(isContextOverflow(429, "")).toBe(false);
    expect(isContextOverflow(429, "Requests to the ChatCompletions_Create Operation have exceeded token rate limit")).toBe(false);
    expect(isContextOverflow(401, "invalid key")).toBe(false);
  });
  it("stores the setting per chat, default 20, project-scoped", async () => {
    const SQL = await initSqlJs();
    const repo = new Repo(wrapSqlJs(new SQL.Database()), { encrypt: async (s: string) => s, decrypt: async (s: string) => s } as never);
    await repo.migrate();
    const p = await repo.createProject("A"), q = await repo.createProject("B");
    const c = await repo.createChat(p.id, "x");
    expect(await repo.getChatContextLimit(p.id, c.id)).toBe(20);
    await repo.setChatContextLimit(p.id, c.id, 1500);
    expect(await repo.getChatContextLimit(p.id, c.id)).toBe(1500);
    expect(await repo.getChatContextLimit(q.id, c.id)).toBe(20);
    await expect(repo.setChatContextLimit(q.id, c.id, 5)).rejects.toThrow();
    await repo.deleteChat(p.id, c.id);
    expect(await repo.getChatContextLimit(p.id, c.id)).toBe(20);
  });
});
