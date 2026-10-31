import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { Repo, IsolationError } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { importRawKey, randomBytes, sealWithPassword, openWithPassword } from "@/lib/crypto";
import { makeVault } from "@/lib/app-db";

let repo: Repo;
let raw: import("sql.js").Database;

beforeEach(async () => {
  const SQL = await initSqlJs();
  raw = new SQL.Database();
  repo = new Repo(wrapSqlJs(raw), makeVault(await importRawKey(randomBytes(32))));
  await repo.migrate();
});

describe("aislamiento entre proyectos", () => {
  it("chats, mensajes, memoria y documentos de A no son visibles desde B", async () => {
    const a = await repo.createProject("A");
    const b = await repo.createProject("B");
    const chat = await repo.createChat(a.id);
    await repo.addMessage(a.id, chat.id, "user", "secreto-de-A");
    await repo.addMemory(a.id, "hecho", "memoria-de-A");
    await repo.addDoc(a.id, { name: "doc-A.txt", mime: "text/plain", size: 3, text: "texto-de-A", filePath: null });

    expect(await repo.listChats(b.id)).toEqual([]);
    expect(await repo.getChat(b.id, chat.id)).toBeNull();
    expect(await repo.listMessages(b.id, chat.id)).toEqual([]);
    expect(await repo.listMemory(b.id)).toEqual([]);
    expect(await repo.listDocs(b.id)).toEqual([]);
    const s = await repo.search(b.id, "A");
    expect(s.messages.length + s.memory.length + s.docs.length).toBe(0);
    const ctx = await repo.buildContext(b.id, "secreto memoria texto");
    expect(ctx).not.toContain("memoria-de-A");
    expect(ctx).not.toContain("texto-de-A");
  });

  it("escribir en un chat de otro proyecto falla", async () => {
    const a = await repo.createProject("A");
    const b = await repo.createProject("B");
    const chat = await repo.createChat(a.id);
    await expect(repo.addMessage(b.id, chat.id, "user", "x")).rejects.toBeInstanceOf(IsolationError);
  });

  it("los chats del mismo proyecto comparten memoria en el contexto", async () => {
    const a = await repo.createProject("A");
    await repo.addMemory(a.id, "decision", "usar PostgreSQL");
    expect(await repo.buildContext(a.id, "base")).toContain("usar PostgreSQL");
  });
});

describe("memoria versionada", () => {
  it("editar crea una versión nueva y conserva las anteriores y los mensajes", async () => {
    const a = await repo.createProject("A");
    const chat = await repo.createChat(a.id);
    await repo.addMessage(a.id, chat.id, "user", "original");
    const id = await repo.addMemory(a.id, "hipotesis", "v1");
    await repo.editMemory(a.id, id, "hecho", "v2");
    const hist = await repo.memoryHistory(a.id, id);
    expect(hist.map((h) => h.content)).toEqual(["v2", "v1"]);
    expect((await repo.listMessages(a.id, chat.id))[0]?.content).toBe("original");
  });
});

describe("API keys", () => {
  it("preserves Azure OpenAI connection fields across save/read/backup without exporting its key", async () => {
    const id = await repo.saveProvider({ name: "Azure OpenAI · deployment", kind: "azure_openai", endpoint: "https://resource.openai.azure.com", apiKey: "TEST-AZURE-KEY", deployment: "deployment", model: "deployment", apiVersion: "2024-10-21", extraParams: "" });
    expect((await repo.listProviders())[0]).toMatchObject({ id, kind: "azure_openai", deployment: "deployment", model: "deployment", api_version: "2024-10-21", extra_params: "", has_key: true });
    const dump = await repo.dumpAll();
    expect(JSON.stringify(dump)).not.toContain("TEST-AZURE-KEY");
    const SQL = await initSqlJs();
    const fresh = new Repo(wrapSqlJs(new SQL.Database()), makeVault(await importRawKey(randomBytes(32))));
    await fresh.migrate();
    await fresh.restoreAll(dump as { tables: Record<string, Record<string, unknown>[]> });
    expect((await fresh.listProviders())[0]).toMatchObject({ kind: "azure_openai", endpoint: "https://resource.openai.azure.com", deployment: "deployment", api_version: "2024-10-21", has_key: false, verification_status: "unverified" });
  });
  it("stores verification status, invalidates edits and resets it after restore", async () => {
    const id = await repo.saveProvider({ name: "x", kind: "openai", model: "m" });
    expect((await repo.listProviders())[0]?.verification_status).toBe("unverified");
    await repo.setProviderVerification(id, "verified");
    expect((await repo.listProviders())[0]?.verification_status).toBe("verified");
    await repo.setProviderVerification(id, "error");
    expect((await repo.listProviders())[0]?.verification_status).toBe("error");
    await repo.saveProvider({ name: "x", kind: "openai", model: "new" }, id);
    expect((await repo.listProviders())[0]?.verification_status).toBe("unverified");
    await repo.setProviderVerification(id, "verified");
    await repo.restoreAll(await repo.dumpAll() as { tables: Record<string, Record<string, unknown>[]> });
    expect((await repo.listProviders())[0]?.verification_status).toBe("unverified");
  });
  it("se guardan cifradas, no en texto plano, y no se exportan", async () => {
    const id = await repo.saveProvider({ name: "x", kind: "openai", model: "m", apiKey: "sk-SENTINEL-123" });
    const bytes = new TextDecoder("latin1").decode(raw.export());
    expect(bytes).not.toContain("sk-SENTINEL-123");
    expect(await repo.getProviderSecret(id)).toBe("sk-SENTINEL-123");
    expect(JSON.stringify(await repo.dumpAll())).not.toContain("SENTINEL");
    expect(JSON.stringify(await repo.listProviders())).not.toContain("v1:");
  });
});

describe("exportación cifrada", () => {
  it("requiere la contraseña correcta y no contiene texto legible", async () => {
    const sealed = await sealWithPassword("clave-larga", JSON.stringify({ x: "contenido-privado" }));
    expect(sealed).not.toContain("contenido-privado");
    await expect(openWithPassword("otra", sealed)).rejects.toThrow();
    expect(JSON.parse(await openWithPassword("clave-larga", sealed)).x).toBe("contenido-privado");
  });
});

describe("exportar e importar un proyecto completo", () => {
  it("recupera conversaciones, memoria (con versiones) y documentos; rechaza contraseña incorrecta", async () => {
    const a = await repo.createProject("Proyecto X", "desc");
    const c = await repo.createChat(a.id, "chat 1");
    await repo.addMessage(a.id, c.id, "user", "hola");
    await repo.addMessage(a.id, c.id, "assistant", "respuesta");
    const mid = await repo.addMemory(a.id, "hecho", "m1");
    await repo.editMemory(a.id, mid, "decision", "m2");
    await repo.addDoc(a.id, { name: "n.md", mime: "text/markdown", size: 5, text: "notas", filePath: "docs/x/n.md" });
    const sealed = await sealWithPassword("contraseña-ok", JSON.stringify(await repo.dumpAll()));
    await expect(openWithPassword("mala", sealed)).rejects.toThrow("Contraseña incorrecta");

    const SQL = await initSqlJs();
    const fresh = new Repo(wrapSqlJs(new SQL.Database()), makeVault(await importRawKey(randomBytes(32))));
    await fresh.migrate();
    await fresh.restoreAll(JSON.parse(await openWithPassword("contraseña-ok", sealed)));
    expect((await fresh.listProjects())[0]?.name).toBe("Proyecto X");
    expect((await fresh.listMessages(a.id, c.id)).map((m) => m.content)).toEqual(["hola", "respuesta"]);
    expect((await fresh.listMemory(a.id))[0]?.content).toBe("m2");
    expect((await fresh.memoryHistory(a.id, mid)).length).toBe(2);
    expect((await fresh.listDocs(a.id))[0]?.text_content).toBe("notas");
  });
});
