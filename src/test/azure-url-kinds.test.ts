import { afterEach, describe, expect, it, vi } from "vitest";
import { azureDeploymentKind, azureKindOf, azureKindParams, parseAzureUrl } from "@/lib/azure-url";
import { testProvider, type ProviderCall } from "@/lib/providers";

afterEach(() => vi.unstubAllGlobals());

describe("Azure URLs copied from the portal", () => {
  it("accepts a deployment TTS URL and extracts deployment, version and type", () => {
    const a = parseAzureUrl("https://pgonia8-4510-resource.openai.azure.com/openai/deployments/gpt-4o-mini-tts/audio/speech?api-version=2025-03-01-preview");
    expect(a).toEqual({ endpoint: "https://pgonia8-4510-resource.openai.azure.com", v1: false, deployment: "gpt-4o-mini-tts", apiVersion: "2025-03-01-preview", op: "tts" });
    expect(azureDeploymentKind(a!.deployment, a!.op)).toBe("tts");
  });
  it("accepts /openai/v1/responses without trimming by hand", () => {
    expect(parseAzureUrl("https://x.openai.azure.com/openai/v1/responses")).toEqual({ endpoint: "https://x.openai.azure.com/openai/v1", v1: true, op: "responses" });
  });
  it("accepts /openai/responses?api-version and services.ai.azure.com hosts", () => {
    expect(parseAzureUrl("https://x.services.ai.azure.com/openai/responses?api-version=2025-04-01-preview")).toMatchObject({ endpoint: "https://x.services.ai.azure.com", v1: false, op: "responses", apiVersion: "2025-04-01-preview" });
  });
  it("still rejects unknown paths and credentials in the URL", () => {
    expect(parseAzureUrl("https://x.openai.azure.com/otra/cosa")).toBeNull();
    expect(parseAzureUrl("https://u:p@x.openai.azure.com/openai/v1")).toBeNull();
  });
  it("gpt-audio is an audio model, not a text chat model", () => {
    expect(azureDeploymentKind("gpt-audio-1.5")).toBe("audio-chat");
    expect(azureDeploymentKind("gpt-4o-mini")).toBe("chat");
    expect(azureKindOf({ deployment: "mi-voz", extraParams: azureKindParams("tts") })).toBe("tts");
  });
});

describe("connection test uses the right request for each type", () => {
  const base: ProviderCall = { kind: "azure_openai", endpoint: "https://r.openai.azure.com/openai/deployments/gpt-4o-mini-tts/audio/speech?api-version=2025-03-01-preview", apiKey: "k", model: "gpt-4o-mini-tts", deployment: "gpt-4o-mini-tts", apiVersion: "2025-03-01-preview", extraParams: azureKindParams("tts") };
  it("TTS deployment is verified on /audio/speech with real audio bytes", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(2000), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await testProvider(base);
    expect(r.ok).toBe(true);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://r.openai.azure.com/openai/deployments/gpt-4o-mini-tts/audio/speech?api-version=2025-03-01-preview");
  });
  it("gpt-audio is verified with audio output and fails if no audio comes back", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ choices: [{ message: { audio: { data: btoa("x".repeat(300)), transcript: "OK" } } }] }), { status: 200 }); }));
    const ok = await testProvider({ ...base, endpoint: "https://r.services.ai.azure.com", deployment: "gpt-audio-1.5", model: "gpt-audio-1.5", apiVersion: "2026-02-23", extraParams: azureKindParams("audio-chat") });
    expect(ok.ok).toBe(true);
    expect(bodies[0].modalities).toEqual(["text", "audio"]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 })));
    const bad = await testProvider({ ...base, endpoint: "https://r.services.ai.azure.com", deployment: "gpt-audio-1.5", model: "gpt-audio-1.5", apiVersion: "2026-02-23", extraParams: azureKindParams("audio-chat") });
    expect(bad.ok).toBe(false);
  });
  it("chat with a pasted /openai/v1/responses URL goes to /openai/v1/chat/completions", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { urls.push(String(u)); return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', { status: 200 }); }));
    const r = await testProvider({ kind: "azure_openai", endpoint: "https://r.openai.azure.com/openai/v1/responses", apiKey: "k", model: "gpt-6", deployment: "gpt-6", apiVersion: "", extraParams: azureKindParams("chat") });
    expect(r.ok).toBe(true);
    expect(urls[0]).toBe("https://r.openai.azure.com/openai/v1/chat/completions");
  });
});
