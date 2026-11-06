import { afterEach, describe, expect, it, vi } from "vitest";
import { isContentBlock, isToolRejection, responseError, streamChat } from "@/lib/providers";

afterEach(() => vi.unstubAllGlobals());
const provider = { kind: "openai" as const, endpoint: "https://example.test/v1", apiKey: "test-only", model: "test" };
const tools = [{ type: "function", function: { name: "inspect", parameters: { type: "object", properties: {} } } }];
const stream = (event: unknown) => new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { "content-type": "text/event-stream" } });

describe("bloqueos de contenido: respuestas controladas, sin proveedores reales", () => {
  const safeFilters = {
    hate: { filtered: false, severity: "safe" },
    self_harm: { filtered: false, severity: "safe" },
    sexual: { filtered: false, severity: "safe" },
    violence: { filtered: false, severity: "safe" },
  };
  it("no bloquea los metadatos seguros de Azure", () => {
    expect(isContentBlock(JSON.stringify({
      prompt_filter_results: [{ prompt_index: 0, content_filter_results: safeFilters }],
      choices: [{ content_filter_results: safeFilters, finish_reason: "stop", message: { content: "Hola" } }],
    }))).toBe(false);
  });
  it.each(["sse", "json"])("Hola recibe respuesta con metadatos Azure en %s sin reintentos", async format => {
    const event = {
      prompt_filter_results: [{ prompt_index: 0, content_filter_results: safeFilters }],
      choices: [{ content_filter_results: safeFilters, finish_reason: "stop", delta: { content: "Hola, Fer" }, message: { content: "Hola, Fer" } }],
    };
    const fetcher = vi.fn().mockResolvedValue(format === "sse" ? stream(event) : new Response(JSON.stringify(event), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const chunks: string[] = [];
    await expect(streamChat(provider, [{ role: "user", content: "Hola" }], text => chunks.push(text))).resolves.toMatchObject({ toolCalls: [] });
    expect(chunks.join("")).toBe("Hola, Fer");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("los metadatos de filtros no convierten otro error en bloqueo", () => {
    expect(responseError(400, JSON.stringify({ error: { code: "invalid_parameter" }, content_filter_results: safeFilters }))).toMatchObject({ code: "parameters" });
  });
  it("no clasifica texto explicativo como una negativa del proveedor", () => {
    expect(isContentBlock(JSON.stringify({ choices: [{ delta: { content: "content_policy_violation y ResponsibleAIPolicyViolation son códigos de error" } }] }))).toBe(false);
  });
  it("detecta códigos anidados y negativas explícitas sin finish_reason", () => {
    expect(isContentBlock(JSON.stringify({ error: { innererror: { code: "ResponsibleAIPolicyViolation" } } }))).toBe(true);
    expect(isContentBlock(JSON.stringify({ choices: [{ message: { refusal: "No puedo responder" } }] }))).toBe(true);
  });
  it.each([200, 400, 403])("distingue content_filter con HTTP %s", status => {
    expect(responseError(status, '{"error":{"code":"content_filter"}}')).toMatchObject({ code: "content_blocked", httpStatus: status });
  });
  it("no confunde un bloqueo que menciona herramientas con incompatibilidad", () => {
    expect(isToolRejection(400, '{"code":"content_filter","message":"function blocked"}')).toBe(false);
  });
  it.each([
    { type: "response.failed", response: { status: "failed", error: { code: "content_filter" } } },
    { choices: [{ finish_reason: "content_filter", delta: {} }] },
    { type: "response.refusal.delta", delta: "refused" },
  ])("detiene el stream sin reintentar", async event => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(stream(event)));
    vi.stubGlobal("fetch", fetcher);
    await expect(streamChat(provider, [{ role: "user", content: "test" }], () => undefined, undefined, { tools })).rejects.toMatchObject({ code: "content_blocked" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserva el bloqueo en Responses sin sustituirlo por el error de herramientas", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"unsupported function tools"}}', { status: 400 }))
      .mockResolvedValueOnce(stream({ type: "response.failed", response: { error: { code: "content_filter" } } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(streamChat(provider, [{ role: "user", content: "test" }], () => undefined, undefined, { tools })).rejects.toMatchObject({ code: "content_blocked" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("detecta bloqueos en respuestas JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"choices":[{"finish_reason":"content_filter","message":{"content":""}}]}', { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(streamChat(provider, [{ role: "user", content: "test" }], () => undefined)).rejects.toMatchObject({ code: "content_blocked" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("no reintenta un bloqueo aunque el estado HTTP sugiera cuota temporal", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('{"error":{"code":"content_filter"}}', { status: 429, headers: { "retry-after-ms": "1" } })));
    vi.stubGlobal("fetch", fetcher);
    await expect(streamChat(provider, [{ role: "user", content: "test" }], () => undefined)).rejects.toMatchObject({ code: "content_blocked" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});