import { afterEach, describe, expect, it, vi } from "vitest";
import { azureDeploymentKind, azureKindCapabilities, cosmosBase, looksLikeCosmosEndpoint } from "@/lib/azure-url";
import { cosmosRowFromUrl } from "@/lib/azure-autosetup";
import { cosmosBody, cosmosResponseText, runCosmos } from "@/lib/core/adapters/cosmos";
import { azureAdapter } from "@/lib/core/adapters/azure";
import { responseError } from "@/lib/providers";

const creds = (endpoint: string) => ({ kind: "azure_openai" as const, endpoint, apiKey: "k-123", deployment: "nvidia--cosmos3-super", apiVersion: null, model: "nvidia--cosmos3-super", extraParams: JSON.stringify({ miai_kind: "cosmos" }) });
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const mp4 = () => { const b = new Uint8Array(200); b.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]); return b; };

afterEach(() => vi.unstubAllGlobals());

describe("NVIDIA Cosmos en Azure (cómputo administrado)", () => {
  it("el nombre nvidia--cosmos3-super se detecta como Cosmos y sirve para video e imágenes", () => {
    expect(azureDeploymentKind("nvidia--cosmos3-super")).toBe("cosmos");
    expect(azureKindCapabilities("cosmos")).toEqual(["video.generate", "image.generate"]);
  });

  it("acepta el URI de destino de Foundry y quita /score o /v1/...", () => {
    expect(cosmosBase("https://cosmos-ep.eastus2.inference.ml.azure.com/score")).toBe("https://cosmos-ep.eastus2.inference.ml.azure.com");
    expect(cosmosBase("https://cosmos-ep.eastus2.inference.ml.azure.com/v1/infer")).toBe("https://cosmos-ep.eastus2.inference.ml.azure.com");
    expect(looksLikeCosmosEndpoint("https://cosmos-ep.eastus2.inference.ml.azure.com/score")).toBe(true);
    expect(looksLikeCosmosEndpoint("https://pgonia8-4510-resource.openai.azure.com/openai/v1")).toBe(false);
    expect(cosmosBase("http://x.inference.ml.azure.com")).toBeNull();
  });

  it("la configuración automática crea una fila Cosmos desde el URI de destino", () => {
    expect(cosmosRowFromUrl("https://cosmos-ep.eastus2.inference.ml.azure.com/score", "nvidia--cosmos3-super")).toEqual({ deployment: "nvidia--cosmos3-super", endpoint: "https://cosmos-ep.eastus2.inference.ml.azure.com", kind: "cosmos" });
  });

  it("con la URL del recurso de Foundry usa /openai/v1/chat/completions y reintenta con Bearer si Azure pide azure-resource-enc", async () => {
    const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
    const vid = b64(mp4());
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>; calls.push({ url, headers, body: JSON.parse(init.body as string) });
      if (headers["api-key"]) return new Response('{"error":{"code":"DeploymentError","message":"Required header \'azure-resource-enc\' is missing or empty."}}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: [{ type: "video", b64_video: vid }] } }] }));
    }));
    const out = await azureAdapter.run(creds("https://pgonia8-4510-resource.services.ai.azure.com/openai/v1/chat/completions"), { capability: "video.generate", model: "nvidia--cosmos3-super", prompt: "un robot" });
    expect(calls[0]!.url).toBe("https://pgonia8-4510-resource.services.ai.azure.com/openai/v1/chat/completions");
    expect(calls[0]!.body.model).toBe("nvidia--cosmos3-super");
    expect(calls[1]!.headers["authorization"]).toBe("Bearer k-123");
    expect(out.kind === "files" && out.files[0]!.mime).toBe("video/mp4");
  });

  it("si Cosmos solo responde texto por esa ruta, lo dice en vez de fingir un video", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Solo puedo describir" } }] }))));
    await expect(azureAdapter.run(creds("https://pgonia8-4510-resource.services.ai.azure.com/openai/v1"), { capability: "video.generate", model: "nvidia--cosmos3-super", prompt: "x" })).rejects.toThrow(/no entregó un video.*Solo puedo describir/);
  });

  it("lee texto de bloques y objetos estructurados del proveedor", () => {
    expect(cosmosResponseText([{ type: "text", text: { value: "Primera" } }, { type: "text", text: "Segunda" }])).toBe("Primera\nSegunda");
    expect(cosmosResponseText({ content: { text: "Respuesta" } })).toBe("Respuesta");
    expect(cosmosResponseText({ type: "video", data: "sin texto" })).toBe("");
  });

  it("una respuesta estructurada sin archivo se rechaza y oculta la clave en el diagnóstico", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "k-123" }] } }] }))));
    let error: unknown;
    try { await runCosmos(creds("https://r.services.ai.azure.com/openai/v1"), { capability: "video.generate", model: "nvidia--cosmos3-super", prompt: "x" }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Se esperaba el rechazo de la respuesta sin video");
    expect(error.message.includes("k-123")).toBe(false);
    expect((error as { technical?: string }).technical?.includes("k-123")).toBe(false);
  });

  it("el chat de Azure reintenta con Bearer y sin streaming cuando Azure pide azure-resource-enc", async () => {
    const { streamChat } = await import("@/lib/providers");
    const seen: { auth: boolean; stream: boolean }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>; const body = JSON.parse(init.body as string);
      seen.push({ auth: !!h["authorization"], stream: body.stream });
      if (body.stream) return new Response('{"error":{"message":"Required header \'azure-resource-enc\' is missing or empty."}}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { headers: { "content-type": "application/json" } });
    }));
    let text = "";
    await streamChat({ kind: "azure_openai", endpoint: "https://r.services.ai.azure.com/openai/v1", apiKey: "k", model: "nvidia--cosmos3-super", deployment: "nvidia--cosmos3-super", apiVersion: "", extraParams: "" }, [{ role: "user", content: "hola" }], (t) => { text += t; });
    expect(seen).toEqual([{ auth: false, stream: true }, { auth: true, stream: true }, { auth: true, stream: false }]);
    expect(text).toBe("OK");
  });

  it("el error 'azure-resource-enc' de Azure se explica claramente", () => {
    const e = responseError(400, '{"error":{"code":"DeploymentError","message":"Required header \'azure-resource-enc\' is missing or empty."}}');
    expect(e.code).toBe("endpoint");
    expect(e.message).toMatch(/Bearer/);
  });

  it("elige el modo correcto: texto→video, imagen→video, texto→imagen", () => {
    expect(cosmosBody({ capability: "video.generate", model: "m", prompt: "a" })).toEqual({ model_mode: "text2video", prompt: "a" });
    expect(cosmosBody({ capability: "image.generate", model: "m", prompt: "a", params: { num_inference_steps: 8, n: 1 } })).toEqual({ model_mode: "text2image", prompt: "a", num_inference_steps: 8 });
    const i2v = cosmosBody({ capability: "video.generate", model: "m", prompt: "a", files: [{ bytes: new Uint8Array([1, 2, 3]), mime: "image/png", name: "a.png" }] });
    expect(i2v["model_mode"]).toBe("image2video");
    expect(i2v["input_reference"]).toBe("data:image/png;base64,AQID");
  });

  it("genera un video MP4 llamando a /v1/infer con la clave como Bearer", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ b64_video: b64(mp4()), action: null })));
    vi.stubGlobal("fetch", fetcher);
    const out = await runCosmos(creds("https://cosmos-ep.eastus2.inference.ml.azure.com/score"), { capability: "video.generate", model: "nvidia--cosmos3-super", prompt: "un robot camina" });
    expect(fetcher.mock.calls[0]![0]).toBe("https://cosmos-ep.eastus2.inference.ml.azure.com/v1/infer");
    expect((fetcher.mock.calls[0]![1].headers as Record<string, string>)["authorization"]).toBe("Bearer k-123");
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({ model_mode: "text2video", prompt: "un robot camina" });
    expect(out.kind === "files" && out.files[0]!.mime).toBe("video/mp4");
  });

  it("una respuesta sin video no se acepta como éxito", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    await expect(runCosmos(creds("https://cosmos-ep.eastus2.inference.ml.azure.com"), { capability: "video.generate", model: "m", prompt: "x" })).rejects.toThrow(/no devolvió un video/);
  });
});
