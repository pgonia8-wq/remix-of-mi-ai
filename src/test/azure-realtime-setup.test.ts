import { afterEach, expect, it, vi } from "vitest";
import { parseRealtimeUrl, testProvider, type ProviderCall } from "@/lib/providers";
import { realtimeEndpoints } from "@/lib/realtime-voice";
afterEach(() => { vi.unstubAllGlobals(); });
const url = "wss://pgonia8-4510-resource.openai.azure.com/openai/v1/realtime?model=gpt-realtime-mini";

it("accepts the Azure portal wss realtime URL and extracts the deployment", () => {
  expect(parseRealtimeUrl(url)).toEqual({ endpoint: "https://pgonia8-4510-resource.openai.azure.com/openai/v1", deployment: "gpt-realtime-mini" });
  expect(parseRealtimeUrl("ws://x.openai.azure.com/openai/v1/realtime?model=a")).toBeNull();
  expect(parseRealtimeUrl("https://x.openai.azure.com/openai/v1")).toBeNull();
});
it("voice sessions accept the wss URL as the same resource over HTTPS", () => {
  expect(realtimeEndpoints("azure_openai", url).secrets).toBe("https://pgonia8-4510-resource.openai.azure.com/openai/v1/realtime/client_secrets");
});
it("verifies a realtime deployment by minting a real session token, not chat completions", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string) => { calls.push(u); return new Response(JSON.stringify({ value: "ephemeral" })); }));
  const p: ProviderCall = { kind: "azure_openai", endpoint: "https://pgonia8-4510-resource.openai.azure.com/openai/v1", apiKey: "unit-test-only", model: "gpt-realtime-mini", deployment: "gpt-realtime-mini", apiVersion: "", extraParams: "" };
  expect(await testProvider(p)).toMatchObject({ ok: true });
  expect(calls).toEqual(["https://pgonia8-4510-resource.openai.azure.com/openai/v1/realtime/client_secrets"]);
});
it("a 200 response without a session token does not verify", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  const p: ProviderCall = { kind: "azure_openai", endpoint: "https://r.openai.azure.com/openai/v1", apiKey: "k", model: "gpt-realtime-mini", deployment: "gpt-realtime-mini" };
  expect(await testProvider(p)).toMatchObject({ ok: false, code: "parameters" });
});
