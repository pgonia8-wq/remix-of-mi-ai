import { afterEach, describe, expect, it, vi } from "vitest";
import { canSaveModel, PROVIDER_KINDS, testProvider, type ProviderCall } from "@/lib/providers";

const draft: ProviderCall = { kind: "openai", endpoint: "https://api.openai.com/v1", apiKey: "sk-TEST-DO-NOT-USE", model: "test-model" };
const sse = (data: unknown) => new Response(`data: ${JSON.stringify(data)}\n\n`, { headers: { "content-type": "text/event-stream" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("provider adapter contracts (controlled responses, not live verification)", () => {
  it("does not accept HTTP 200 without generated text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: [DONE]\n\n")));
    expect(await testProvider(draft)).toMatchObject({ ok: false, code: "parameters" });
  });
  it("rejects invalid keys and never exposes echoed credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: `Invalid API key ${draft.apiKey}` } }), { status: 401 })));
    const result = await testProvider(draft);
    expect(result).toMatchObject({ ok: false, code: "key", httpStatus: 401 });
    expect(JSON.stringify(result)).not.toContain(draft.apiKey);
  });
  it("distinguishes authentication errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("permission denied", { status: 403 })));
    expect(await testProvider(draft)).toMatchObject({ ok: false, code: "auth" });
  });
  it("distinguishes incorrect endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })));
    expect(await testProvider(draft)).toMatchObject({ ok: false, code: "endpoint" });
  });
  it("distinguishes nonexistent models and deployments", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":{"code":"model_not_found"}}', { status: 404 })));
    expect(await testProvider(draft)).toMatchObject({ ok: false, code: "model" });
  });
  it("distinguishes unavailable models", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("overloaded", { status: 503 })));
    expect(await testProvider(draft)).toMatchObject({ ok: false, code: "unavailable" });
  });
  it("distinguishes network failure without exposing fetch errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(`network ${draft.apiKey}`)));
    const result = await testProvider(draft);
    expect(result).toMatchObject({ ok: false, code: "network" });
    expect(JSON.stringify(result)).not.toContain(draft.apiKey);
  });
  it("times out and aborts an unresponsive request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetcher);
    const result = testProvider(draft, 20);
    await vi.advanceTimersByTimeAsync(21);
    expect(await result).toMatchObject({ ok: false, code: "timeout" });
    expect(fetcher.mock.calls[0]?.[1].signal.aborted).toBe(true);
  });
  it("rejects parameters that override the tested model", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await testProvider({ ...draft, extraParams: '{"model":"another"}' })).toMatchObject({ ok: false, code: "parameters" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("surfaces stream errors even after HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse({ error: { code: "model_not_found" } })));
    expect(await testProvider(draft)).toMatchObject({ ok: false, code: "model" });
  });
  it.each(PROVIDER_KINDS)("uses $kind authentication and payload", async ({ kind, endpoint, model }) => {
    const data = kind === "anthropic" ? { type: "content_block_delta", delta: { text: "OK" } } : kind === "gemini" ? { candidates: [{ content: { parts: [{ text: "OK" }] } }] } : kind === "cohere" ? { type: "content-delta", delta: { message: { content: { text: "OK" } } } } : { choices: [{ delta: { content: "OK" } }] };
    const fetcher = vi.fn().mockResolvedValue(sse(data)); vi.stubGlobal("fetch", fetcher);
    const result = await testProvider({ ...draft, kind, endpoint: kind === "custom" ? "https://custom.example/v1" : endpoint, model, deployment: "deployment", apiVersion: "2024-10-21" });
    expect(result.ok).toBe(true); // parser contract only; this is NOT a real connection
    const [url, init] = fetcher.mock.calls[0] ?? [];
    const body = JSON.parse(init.body);
    expect(init.method).toBe("POST");
    if (kind === "anthropic") { expect(url).toContain("/messages"); expect(init.headers["x-api-key"]).toBe(draft.apiKey); expect(body.max_tokens).toBe(4096); }
    else if (kind === "gemini") { expect(url).toContain(":streamGenerateContent?alt=sse"); expect(init.headers["x-goog-api-key"]).toBe(draft.apiKey); expect(body.contents[0].parts[0].text).toBe("Responde solo: OK"); }
    else if (kind === "azure") { expect(url).toContain("/deployments/deployment/chat/completions?api-version=2024-10-21"); expect(init.headers["api-key"]).toBe(draft.apiKey); }
    else { expect(init.headers.authorization).toBe(`Bearer ${draft.apiKey}`); expect(url).toContain(kind === "cohere" ? "/chat" : "/chat/completions"); }
  });
  it("requires success for the exact current configuration before saving", () => {
    expect(canSaveModel(draft, null, null)).toBe(false);
    expect(canSaveModel(draft, draft, { ok: false, code: "auth", message: "failed" })).toBe(false);
    const success = { ok: true as const, checkedAt: 1 };
    expect(canSaveModel(draft, draft, success)).toBe(true);
    for (const field of ["endpoint", "apiKey", "model", "deployment", "apiVersion", "extraParams", "kind"]) expect(canSaveModel({ ...draft, [field]: "changed" }, draft, success)).toBe(false);
  });
});