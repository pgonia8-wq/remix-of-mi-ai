// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { azureVideoForm, azureVideoUrl, pollAzureVideo, runAzureVideo } from "@/lib/core/adapters/azure-video";
import type { AdapterCredentials } from "@/lib/core/adapters/types";
const credentials: AdapterCredentials = { kind: "azure_openai", endpoint: "https://resource.services.ai.azure.com/openai/v1/chat/completions", apiKey: "fixture-not-real", model: "video-deployment", deployment: "video-deployment", apiVersion: null, extraParams: null };
afterEach(() => vi.unstubAllGlobals());
describe("Azure Sora 2 v1 video contract, controlled responses", () => {
  it("uses multipart deployment selection and duration 4/8/12 only", async () => {
    const fetcher = vi.fn(async () => new Response('{"id":"video-123","status":"queued"}')); vi.stubGlobal("fetch", fetcher);
    expect(await runAzureVideo(credentials, { capability: "video.generate", model: "my-video-deployment", prompt: "Ball", params: { seconds: 8, ratio: "1280:720" } })).toEqual({ kind: "remote", remoteId: "video-123" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://resource.services.ai.azure.com/openai/v1/videos");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("model")).toBe("my-video-deployment");
    expect((init.body as FormData).get("seconds")).toBe("8");
    expect((init.body as FormData).get("size")).toBe("1280x720");
    expect(new Headers(init.headers).has("content-type")).toBe(false);
    expect(init.redirect).toBe("error");
    for (const seconds of [4,8,12]) expect(azureVideoForm({ capability: "video.generate", model: "m", prompt: "p", params: { seconds } }).get("seconds")).toBe(String(seconds));
    expect(() => azureVideoForm({ capability: "video.generate", model: "m", prompt: "p", params: { seconds: 5 } })).toThrow(/4, 8 o 12/);
  });
  it("rejects unsupported references and legacy endpoints rather than discarding or rewriting", () => {
    expect(() => azureVideoForm({ capability: "video.generate", model: "m", prompt: "p", files: [{ bytes: new Uint8Array(1), mime: "image/png", name: "x" }] })).toThrow(/referencia/);
    expect(() => azureVideoUrl({ ...credentials, endpoint: "https://resource.openai.azure.com" })).toThrow(/v1/);
    expect(() => azureVideoUrl(credentials, "../../escape")).toThrow(/Identificador/);
  });
  it("polls without resubmission and downloads only from the saved Azure origin", async () => {
    const mp4 = new Uint8Array(120); mp4.set(new TextEncoder().encode("ftyp"),4);
    const fetcher = vi.fn(async (url: string) => url.endsWith("/content") ? new Response(mp4, { headers: { "content-type": "video/mp4" } }) : new Response('{"id":"video-123","status":"completed","output":"https://attacker.example/result"}'));
    vi.stubGlobal("fetch", fetcher);
    expect((await pollAzureVideo(credentials,"video-123")).kind).toBe("files");
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).toMatch(/^https:\/\/resource.services.ai.azure.com\/openai\/v1\/videos\/video-123/);
      expect(init.method).not.toBe("POST"); expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("api-key")).toBe(credentials.apiKey);
    }
  });
  it("does not fetch content for pending or failed jobs", async () => {
    for (const status of ["queued", "in_progress"]) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ status, progress: 35 }))); vi.stubGlobal("fetch", fetcher);
      expect(await pollAzureVideo(credentials,"video-123")).toEqual({ kind: "pending", progress: 0.35 }); expect(fetcher).toHaveBeenCalledTimes(1);
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"status":"failed"}')));
    await expect(pollAzureVideo(credentials,"video-123")).rejects.toThrow(/no completó/);
  });
  it("rejects a false MP4 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/content") ? new Response(new Uint8Array(120), { headers: { "content-type": "video/mp4" } }) : new Response('{"status":"completed"}')));
    await expect(pollAzureVideo(credentials,"video-123")).rejects.toThrow(/no es MP4/);
  });
});