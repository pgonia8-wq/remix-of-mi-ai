import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs, type SqlDb } from "@/lib/db/sql";
import { importRawKey, randomBytes } from "@/lib/crypto";
import { makeVault } from "@/lib/app-db";
import { parseMarkdown, tablesOf } from "@/lib/docs/markdown";
import { extractJson } from "@/lib/core/ai";
import { schedule, validateQuiz, validateCards, cards } from "@/lib/core/study";
import { chunkText, cosine, rankHits } from "@/lib/core/semantic";
import { dedupeSources, invalidCitations } from "@/lib/core/research";
import { notes, tasks, parseTaskLines } from "@/lib/core/productivity";
import { getAdapter } from "@/lib/core/adapters";
import { docKind, extractText } from "@/lib/docs/extract";
import { exportDoc } from "@/lib/docs/export";
import type { AdapterCredentials } from "@/lib/core/adapters/types";

let db: SqlDb, repo: Repo;
beforeEach(async () => {
  const SQL = await initSqlJs();
  db = wrapSqlJs(new SQL.Database());
  repo = new Repo(db, makeVault(await importRawKey(randomBytes(32))));
  await repo.migrate();
});
afterEach(() => vi.unstubAllGlobals());
const creds = (o: Partial<AdapterCredentials>): AdapterCredentials => ({ kind: "openai", endpoint: null, apiKey: "sk-x", deployment: null, apiVersion: null, model: "m", extraParams: null, ...o });
const stub = (body: unknown, status = 200) => { const f = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify(body), { status })); vi.stubGlobal("fetch", f); return f; };

describe("Fase 4: documentos", () => {
  it("Markdown: encabezados, listas y tablas", () => {
    const md = "# Título\n\nTexto **fuerte**.\n\n- uno\n1. dos\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
    const b = parseMarkdown(md);
    expect(b[0]).toEqual({ t: "h", level: 1, text: "Título" });
    expect(b[1]).toEqual({ t: "p", text: "Texto fuerte." });
    expect(b.filter((x) => x.t === "li").length).toBe(2);
    expect(tablesOf(md)).toEqual([[["A", "B"], ["1", "2"], ["3", "4"]]]);
  });
  it("detecta formatos admitidos", () => {
    expect(docKind("a.pdf", "")).toBe("pdf");
    expect(docKind("a.docx", "")).toBe("docx");
    expect(docKind("a.xlsx", "")).toBe("sheet");
    expect(docKind("a.csv", "text/csv")).toBe("sheet");
    expect(docKind("a.md", "")).toBe("text");
    expect(docKind("a.exe", "application/x-msdownload")).toBe("unsupported");
  });
  it("exporta Excel con tablas y lo vuelve a leer en el teléfono", async () => {
    const x = await exportDoc("| Mes | Total |\n|---|---|\n| Enero | 100 |", "xlsx", "t");
    expect(Array.from(x.slice(0, 2))).toEqual([0x50, 0x4b]); // ZIP container
    const back = await extractText(x, "t.xlsx", "");
    expect(back.text).toContain("Enero,100");
  });
  it("exporta Word y PDF válidos", async () => {
    const d = await exportDoc("# Hola\n\nTexto\n\n| a | b |\n|---|---|\n| 1 | 2 |", "docx", "t");
    expect(Array.from(d.slice(0, 2))).toEqual([0x50, 0x4b]);
    const p = await exportDoc("# Hola\n\nTexto largo ".repeat(200), "pdf", "t");
    expect(new TextDecoder().decode(p.slice(0, 5))).toBe("%PDF-");
  });
  it("rechaza documentos de más de 50 MB", async () => {
    await expect(extractText(new Uint8Array(50 * 1024 * 1024 + 1), "a.txt", "text/plain")).rejects.toThrow(/50 MB/);
  });
  it("extrae JSON de respuestas con texto o bloques ```json", () => {
    expect(extractJson<{ a: number }>('Claro:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson<number[]>('Aquí: [1, 2, {"x": "}"}] fin')).toEqual([1, 2, { x: "}" }]);
    expect(() => extractJson("sin datos")).toThrow();
  });
});

describe("Fase 4: notas y tareas", () => {
  it("aisladas por proyecto", async () => {
    const a = await repo.createProject("A"), b = await repo.createProject("B");
    await notes.save(db, a.id, { title: "Secreto A", body: "x" });
    await tasks.add(db, a.id, { title: "Tarea A" });
    expect(await notes.list(db, b.id)).toEqual([]);
    expect(await tasks.list(db, b.id)).toEqual([]);
    const [t] = await tasks.list(db, a.id);
    await tasks.toggle(db, b.id, t!.id, true); // other project cannot modify
    expect((await tasks.list(db, a.id))[0]!.done).toBe(0);
    await repo.deleteProject(a.id);
    expect((await db.all(`SELECT * FROM notes`)).length).toBe(0);
  });
  it("ordena pendientes antes que completadas y por fecha", async () => {
    const a = await repo.createProject("A");
    const late = await tasks.add(db, a.id, { title: "Después", dueAt: 2000 });
    await tasks.add(db, a.id, { title: "Antes", dueAt: 1000 });
    await tasks.toggle(db, a.id, late, true);
    expect((await tasks.list(db, a.id)).map((t) => t.title)).toEqual(["Antes", "Después"]);
  });
  it("convierte listas del modelo en tareas", () => {
    expect(parseTaskLines("Tareas:\n- [ ] Llamar a Ana\n- [x] Enviar factura\n2. Revisar contrato\ntexto suelto")).toEqual(["Llamar a Ana", "Enviar factura", "Revisar contrato"]);
  });
});

describe("Fase 5: investigación", () => {
  it("Tavily envía la búsqueda con Bearer y devuelve fuentes", async () => {
    const f = stub({ results: [{ title: "T", url: "https://a.com", content: "c" }] });
    const r = await getAdapter("tavily").run(creds({ kind: "tavily" }), { capability: "research.web", model: "search", prompt: "hola", params: { max: 3 } });
    expect(r).toEqual({ kind: "search", results: [{ title: "T", url: "https://a.com", snippet: "c" }] });
    expect(f.mock.calls[0]![0]).toBe("https://api.tavily.com/search");
    expect((f.mock.calls[0]![1].headers as Record<string, string>)["authorization"]).toBe("Bearer sk-x");
    expect(JSON.parse(String(f.mock.calls[0]![1].body)).max_results).toBe(3);
  });
  it("Tavily 401 es error, no resultados vacíos", async () => {
    stub({ detail: "bad" }, 401);
    await expect(getAdapter("tavily").run(creds({ kind: "tavily" }), { capability: "research.web", model: "s", prompt: "x" })).rejects.toMatchObject({ httpStatus: 401 });
  });
  it("quita fuentes duplicadas y detecta citas inexistentes", () => {
    expect(dedupeSources([{ title: "a", url: "https://x.com/a?u=1", snippet: "" }, { title: "b", url: "https://x.com/a/", snippet: "" }]).length).toBe(1);
    expect(invalidCitations("Dato [1] y otro [4] y [0].", 3).sort()).toEqual([0, 4]);
  });
});

describe("Fase 5: memoria inteligente", () => {
  it("fragmenta con solapamiento y sin perder texto", () => {
    const t = "palabra ".repeat(1000);
    const ch = chunkText(t, 1200, 150);
    expect(ch.length).toBeGreaterThan(5);
    expect(ch.every((c) => c.length <= 1200)).toBe(true);
    expect(chunkText("   ")).toEqual([]);
  });
  it("ordena por similitud y descarta lo irrelevante", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    const rows = [{ source_type: "note", source_id: "1", text: "a", vector: "[1,0]" }, { source_type: "note", source_id: "2", text: "b", vector: "[0.7,0.7]" }, { source_type: "note", source_id: "3", text: "c", vector: "[0,1]" }];
    expect(rankHits([1, 0], rows, 5).map((h) => h.source_id)).toEqual(["1", "2"]);
  });
  it("embeddings OpenAI y Azure (v1 y clásica)", async () => {
    let f = stub({ data: [{ index: 1, embedding: [0.2] }, { index: 0, embedding: [0.1] }] });
    const r = await getAdapter("openai").run(creds({}), { capability: "embedding", model: "text-embedding-3-small", params: { inputs: ["a", "b"] } });
    expect(r).toEqual({ kind: "vectors", vectors: [[0.1], [0.2]] });
    expect(f.mock.calls[0]![0]).toBe("https://api.openai.com/v1/embeddings");
    f = stub({ data: [{ embedding: [1] }] });
    await getAdapter("azure_openai").run(creds({ kind: "azure_openai", endpoint: "https://x.openai.azure.com", apiVersion: "2024-10-21" }), { capability: "embedding", model: "emb", prompt: "a" });
    expect(f.mock.calls[0]![0]).toBe("https://x.openai.azure.com/openai/deployments/emb/embeddings?api-version=2024-10-21");
    stub({ data: [] });
    await expect(getAdapter("openai").run(creds({}), { capability: "embedding", model: "m", prompt: "a" })).rejects.toThrow(/no coincide/);
  });
});

describe("Fase 5: estudio", () => {
  it("valida cuestionarios y descarta preguntas mal formadas", () => {
    const qs = validateQuiz({ questions: [{ question: "¿2+2?", options: ["3", "4"], answer: 1, explanation: "" }, { question: "mala", options: ["a"], answer: 0 }, { question: "x", options: ["a", "b"], answer: 5 }] });
    expect(qs.length).toBe(1);
    expect(() => validateQuiz({ questions: [] })).toThrow();
    expect(validateCards([{ front: "a", back: "b" }, { front: "", back: "c" }])).toEqual([{ front: "a", back: "b" }]);
  });
  it("repaso espaciado SM-2: 1 día, 6 días, luego crece; fallar reinicia", () => {
    const now = 0, c0 = { ease: 2.5, interval_days: 0, reps: 0 };
    const c1 = schedule(c0, 4, now); expect(c1.interval_days).toBe(1);
    const c2 = schedule(c1, 4, now); expect(c2.interval_days).toBe(6);
    const c3 = schedule(c2, 5, now); expect(c3.interval_days).toBeGreaterThan(14);
    const f = schedule(c3, 0, now); expect(f.reps).toBe(0); expect(f.due_at).toBe(600_000); expect(f.ease).toBeLessThan(c3.ease);
  });
  it("tarjetas aisladas por proyecto", async () => {
    const a = await repo.createProject("A"), b = await repo.createProject("B");
    await cards.add(db, a.id, "Bio", [{ front: "q", back: "r" }]);
    expect((await cards.due(db, a.id)).length).toBe(1);
    expect(await cards.due(db, b.id)).toEqual([]);
    expect(await cards.decks(db, b.id)).toEqual([]);
  });
});
