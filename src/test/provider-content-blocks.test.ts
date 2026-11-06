import { afterEach, describe, expect, it, vi } from "vitest";
import { isToolRejection, responseError, streamChat } from "@/lib/providers";

afterEach(() => vi.unstubAllGlobals());
const provider = { kind: "openai" as const, endpoint: "https://example.test/v1", apiKey: "test-only", model: "test" };
const tools = [{ type: "function", function: { name: "inspect", parameters: { type: "object", properties: {} } } }];
const stream = (event: unknown) => new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { "content-type": "text/event-stream" } });

describe("bloqueos de contenido: respuestas controladas, sin proveedores reales", () => {
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
});