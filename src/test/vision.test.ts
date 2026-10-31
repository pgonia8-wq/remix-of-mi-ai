import { describe, it, expect, vi, afterEach } from "vitest";
import { getAdapter } from "@/lib/core/adapters";
import { TEST_PNG_B64, visionBody, parseVision } from "@/lib/core/adapters/vision";
import { b64ToBytes, type AdapterCredentials } from "@/lib/core/adapters/types";

const png = { bytes: b64ToBytes(TEST_PNG_B64), mime: "image/png", name: "a.png" };
const creds = (o: Partial<AdapterCredentials>): AdapterCredentials => ({ kind: "openai", endpoint: null, apiKey: "sk-secret-123", deployment: null, apiVersion: null, model: "gpt-4o", extraParams: null, ...o });
const ok = { choices: [{ message: { content: "azul" } }] };

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown, status = 200) {
  const f = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("vision", () => {
  it("test image is a real PNG", () => {
    expect(Array.from(png.bytes.slice(1, 4))).toEqual([80, 78, 71]);
  });

  it("OpenAI sends image as data URL to chat/completions with Bearer auth", async () => {
    const f = stub(ok);
    const r = await getAdapter("openai").run(creds({}), { capability: "vision", model: "gpt-4o", prompt: "¿color?", files: [png] });
    expect(r).toEqual({ kind: "text", text: "azul" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-4o");
    expect(body.messages[0].content[1].image_url.url.startsWith("data:image/png;base64,")).toBe(true);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-secret-123");
  });

  it("Azure v1 puts deployment in body; legacy puts it in route with api-version", async () => {
    let f = stub(ok);
    await getAdapter("azure_openai").run(creds({ kind: "azure_openai", endpoint: "https://x.services.ai.azure.com/openai/v1/chat/completions" }), { capability: "vision", model: "gpt-4o-dep", files: [png] });
    expect(f.mock.calls[0]![0]).toBe("https://x.services.ai.azure.com/openai/v1/chat/completions");
    expect(JSON.parse(String(f.mock.calls[0]![1].body)).model).toBe("gpt-4o-dep");
    f = stub(ok);
    await getAdapter("azure_openai").run(creds({ kind: "azure_openai", endpoint: "https://x.openai.azure.com", apiVersion: "2024-10-21" }), { capability: "vision", model: "dep", files: [png] });
    expect(f.mock.calls[0]![0]).toBe("https://x.openai.azure.com/openai/deployments/dep/chat/completions?api-version=2024-10-21");
    expect(JSON.parse(String(f.mock.calls[0]![1].body)).model).toBeUndefined();
  });

  it("rejects missing image, unsupported format and oversize before any request", () => {
    expect(() => visionBody({ capability: "vision", model: "m" }, true)).toThrow(/al menos una imagen/);
    expect(() => visionBody({ capability: "vision", model: "m", files: [{ ...png, mime: "image/tiff" }] }, true)).toThrow(/Formato no admitido/);
    expect(() => visionBody({ capability: "vision", model: "m", files: [{ ...png, bytes: new Uint8Array(20_000_001) }] }, true)).toThrow(/demasiado grande/);
  });

  it("empty model answer is an error, not success", () => {
    expect(() => parseVision({ choices: [{ message: { content: "" } }] })).toThrow(/Respuesta inválida/);
  });

  it("HTTP 401 surfaces as error without leaking the key", async () => {
    stub({ error: { message: "bad key sk-secret-123" } }, 401);
    const e = await getAdapter("openai").run(creds({}), { capability: "vision", model: "gpt-4o", files: [png] }).catch((x) => x);
    expect(e.httpStatus).toBe(401);
    expect(JSON.stringify({ m: e.message, t: e.technical })).not.toContain("sk-secret-123");
  });
});
