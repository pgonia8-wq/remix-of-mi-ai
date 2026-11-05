import { afterEach, describe, expect, it, vi } from "vitest";
import { azureDeploymentKind, azureKindCapabilities, cosmosBase, looksLikeCosmosEndpoint } from "@/lib/azure-url";
import { cosmosRowFromUrl } from "@/lib/azure-autosetup";
import { cosmosBody, runCosmos } from "@/lib/core/adapters/cosmos";
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

  it("con la URL del recurso de Azure OpenAI explica que hay que usar el URI de destino, sin llamar a Azure", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(azureAdapter.run(creds("https://pgonia8-4510-resource.openai.azure.com/openai/v1"), { capability: "video.generate", model: "nvidia--cosmos3-super", prompt: "x" })).rejects.toThrow(/URI de destino/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("el error 'azure-resource-enc' de Azure se traduce a una indicación clara", () => {
    const e = responseError(400, '{"error":{"code":"DeploymentError","message":"Required header \'azure-resource-enc\' is missing or empty."}}');
    expect(e.code).toBe("endpoint");
    expect(e.message).toMatch(/URI de destino/);
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
