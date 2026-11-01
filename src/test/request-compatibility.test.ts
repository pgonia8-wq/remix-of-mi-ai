import { describe, expect, it, vi } from "vitest";
import { INITIAL_CAPABILITIES } from "@/lib/core/capabilities";
import { requestIssues } from "@/lib/core/request-compatibility";
import { route } from "@/lib/core/router";
import { execute } from "@/lib/core/executor";
import type { ModelWithCaps } from "@/lib/core/registry";
import type { Repo } from "@/lib/db/repo";
import type { JobManager } from "@/lib/core/jobs";
import type { AssetStore } from "@/lib/core/asset-store";

const model: ModelWithCaps = { id: "model", provider_id: "provider", remote_id: "deployment", name: "Deployment", status: "active", source: "manual", favorite: 0, cost_info: null, privacy: "external", context_tokens: 1000, updated_at: 1, capabilities: ["vision", "image.generate", "audio.tts", "video.generate"], provider_kind: "azure_openai", provider_name: "Azure", provider_enabled: 1, adapter_id: "azure_openai", tests: [] };
const spec = (id: string) => INITIAL_CAPABILITIES.find((c) => c.id === id) ?? null;

describe("Compatibilidad real antes de enviar una solicitud", () => {
  it("no selecciona Azure para video aunque se declare esa capacidad", () => {
    expect(route([model], { capability: "video.generate", mode: "auto" }).ok).toBe(false);
  });
  it("rechaza audio como entrada de visión y admite PNG", () => {
    expect(route([model], { capability: "vision", mode: "auto", inputMime: "audio/wav" }).ok).toBe(false);
    expect(route([model], { capability: "vision", mode: "auto", inputMime: "image/png" }).ok).toBe(true);
  });
  it("respeta 20.000.000 bytes de visión, sin confundir bytes con MiB", () => {
    expect(requestIssues(spec("vision"), { files: [{ mime: "image/png", size: 20_000_000 }] })).toEqual([]);
    expect(requestIssues(spec("vision"), { files: [{ mime: "image/png", size: 20_000_001 }] }).length).toBe(1);
  });
  it("comprueba todos los archivos, no solo el primero", () => {
    expect(requestIssues(spec("vision"), { files: [{ mime: "image/png", size: 10 }, { mime: "audio/wav", size: 10 }] }).length).toBe(1);
  });
  it("respeta cantidad 1–4 y tamaños declarados de generación", () => {
    expect(requestIssues(spec("image.generate"), { params: { n: 4, size: "1024x1024" } })).toEqual([]);
    expect(requestIssues(spec("image.generate"), { params: { n: 5 } }).length).toBe(1);
    expect(requestIssues(spec("image.generate"), { params: { size: "8192x8192" } }).length).toBe(1);
  });
  it("respeta 4096 caracteres TTS", () => {
    expect(requestIssues(spec("audio.tts"), { prompt: "a".repeat(4096) })).toEqual([]);
    expect(requestIssues(spec("audio.tts"), { prompt: "a".repeat(4097) }).length).toBe(1);
  });
  it("no elige un modelo con contexto declarado insuficiente", () => {
    expect(route([model], { capability: "vision", mode: "auto", contextTokens: 1001 }).ok).toBe(false);
    expect(route([model], { capability: "vision", mode: "auto", contextTokens: 1000 }).ok).toBe(true);
  });
  it("no inventa límites para parámetros desconocidos", () => {
    expect(requestIssues(spec("vision"), { params: { providerOption: "custom" } })).toEqual([]);
  });
  it("revalida un proveedor deshabilitado antes de acceder a claves o crear trabajos", async () => {
    const secrets = vi.fn(), create = vi.fn();
    const repo = { registry: { listModels: async () => [{ ...model, provider_enabled: 0 }] }, getProviderSecret: secrets } as unknown as Repo;
    await expect(execute({ repo, jobs: { create } as unknown as JobManager, assets: {} as AssetStore }, "project", model, { capability: "vision" })).rejects.toThrow(/ya no está disponible/);
    expect(secrets).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it("una entrada incompatible no obtiene claves, no crea trabajos ni llama al proveedor", async () => {
    const secrets = vi.fn(), create = vi.fn();
    const repo = { registry: { listModels: async () => [model], getCapability: async () => spec("vision") }, getProviderSecret: secrets } as unknown as Repo;
    await expect(execute({ repo, jobs: { create } as unknown as JobManager, assets: {} as AssetStore }, "project", model, { capability: "vision", files: [{ mime: "audio/wav", name: "a.wav", bytes: new Uint8Array(10) }] })).rejects.toThrow(/Formato/);
    expect(secrets).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
});