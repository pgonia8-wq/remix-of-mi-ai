// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { makeVault } from "@/lib/app-db";
import { importRawKey, randomBytes } from "@/lib/crypto";
import { JobManager } from "@/lib/core/jobs";
import { AssetStore, sqlBlobBackend } from "@/lib/core/asset-store";
import { KeyRing, webBackend } from "@/lib/core/keys";
import { getAdapter } from "@/lib/core/adapters";
import { execute } from "@/lib/core/executor";
import { pollRemoteJob } from "@/lib/core/remote-jobs";
import { downloadMedia } from "@/lib/core/adapters/media-output";
import { runwayBody } from "@/lib/core/adapters/runway";
import type { Core } from "@/lib/core";
import type { AdapterCredentials } from "@/lib/core/adapters/types";

let core: Core;
const credentials: AdapterCredentials = { kind: "elevenlabs", endpoint: null, apiKey: "test-private-key", deployment: null, apiVersion: null, model: "music_v1", extraParams: null };
beforeEach(async () => {
  const SQL = await initSqlJs(), db = wrapSqlJs(new SQL.Database());
  const repo = new Repo(db, makeVault(await importRawKey(randomBytes(32)))); await repo.migrate();
  const storage = new Map<string, string>();
  const keys = new KeyRing(db, webBackend({ get: (k) => storage.get(k) ?? null, set: (k, v) => { storage.set(k, v); }, del: (k) => { storage.delete(k); } }));
  const profile = { name: "economico" as const, blockSize: 64 * 1024, concurrency: 1, reasons: [] };
  const files = sqlBlobBackend(db);
  core = { repo, keys, files, assets: new AssetStore(db, files, keys, () => profile), jobs: new JobManager(db), profile, device: { availMemMB: 500, totalMemMB: 3000, lowMemory: false, cores: 4, abis: [], freeStorageMB: null, batteryPct: null, charging: null, thermal: null, strongBox: false, source: "browser" }, startup: { temps: 0, orphans: 0, requeued: 0, interrupted: 0, needsUser: 0 } };
});
afterEach(() => vi.unstubAllGlobals());
describe("Música y medios: contratos y trabajos", () => {
  it("música utiliza su API independiente de TTS y rechaza respuesta JSON", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(200), { headers: { "content-type": "audio/mpeg" } })); vi.stubGlobal("fetch", fetcher);
    const result = await getAdapter("elevenlabs").run(credentials, { capability: "music.generate", model: "music_v1", prompt: "Piano", params: { seconds: 3, instrumental: true } });
    expect(result.kind).toBe("files");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/music?");
    expect(JSON.parse(String(init.body))).toEqual({ prompt: "Piano", music_length_ms: 3000, model_id: "music_v1", force_instrumental: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{}', { headers: { "content-type": "application/json" } })));
    await expect(getAdapter("elevenlabs").run(credentials, { capability: "music.generate", model: "music_v1", prompt: "Piano" })).rejects.toThrow(/audio válido/);
  });
  it("video elige contratos distintos para texto, imagen y video", () => {
    expect(runwayBody({ capability: "video.generate", model: "gen4.5", prompt: "Ball", params: { seconds: 4 } }).route).toBe("text_to_video");
    expect(runwayBody({ capability: "video.generate", model: "gen4.5", prompt: "Ball", files: [{ bytes: new Uint8Array(12), mime: "image/png", name: "a.png" }] }).route).toBe("image_to_video");
    expect(() => runwayBody({ capability: "video.edit", model: "aleph2", prompt: "Edit" })).toThrow(/entrada/);
    expect(() => runwayBody({ capability: "video.generate", model: "gen4.5", prompt: "Ball", params: { seconds: 11 } })).toThrow(/duración/i);
  });
  it("descargas no reciben autorización, cookies ni redirecciones", async () => {
    const glb = new Uint8Array(120); glb.set(new TextEncoder().encode("glTF"));
    const fetcher = vi.fn(async () => new Response(glb, { headers: { "content-type": "model/gltf-binary" } })); vi.stubGlobal("fetch", fetcher);
    await downloadMedia("https://assets.example.com/result.glb", "model/gltf-binary");
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toBeUndefined(); expect(init.credentials).toBe("omit"); expect(init.redirect).toBe("error");
    await expect(downloadMedia("http://assets.example.com/a", "video/mp4")).rejects.toThrow(/HTTPS/);
    await expect(downloadMedia("https://user:password@assets.example.com/a", "video/mp4")).rejects.toThrow(/credenciales/);
  });
  it("persiste ID remoto, recupera con polling y no reenvía generación", async () => {
    const project = await core.repo.createProject("Media");
    const provider = await core.repo.saveProvider({ name: "Meshy", kind: "meshy", model: "meshy-6", apiKey: "test-key" });
    const mid = await core.repo.registry.upsertModel({ providerId: provider, remoteId: "meshy-6", source: "manual" });
    await core.repo.registry.setModelCapabilities(mid, ["model3d.generate"]);
    const model = (await core.repo.registry.listModels()).find((m) => m.id === mid); if (!model) throw new Error("Fixture");
    const glb = new Uint8Array(120); glb.set(new TextEncoder().encode("glTF"));
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts++; return new Response('{"result":"remote-123"}'); }
      if (String(url).includes("assets.example")) return new Response(glb, { headers: { "content-type": "model/gltf-binary" } });
      return new Response('{"status":"SUCCEEDED","model_urls":{"glb":"https://assets.example.com/a.glb"}}');
    }));
    const submitted = await execute(core, project.id, model, { capability: "model3d.generate", prompt: "Cube" });
    expect(submitted.pending).toBe(true); expect((await core.jobs.get(project.id, submitted.jobId))?.remote_id).toBe("text:remote-123");
    await expect(execute(core, project.id, model, { capability: "model3d.generate", prompt: "Cube", existingJobId: submitted.jobId })).rejects.toThrow(/identificador remoto/);
    expect((await core.jobs.recoverOnStart(() => true)).interrupted).toBe(1);
    await pollRemoteJob(core, project.id, submitted.jobId);
    expect(posts).toBe(1); expect((await core.jobs.get(project.id, submitted.jobId))?.status).toBe("completed");
    const assets = await core.assets.list(project.id); expect(assets).toHaveLength(1); expect(assets[0]?.kind).toBe("model3d");
    const other = await core.repo.createProject("Other");
    await expect(pollRemoteJob(core, other.id, submitted.jobId)).rejects.toThrow();
  });
  it("no completa un trabajo al recibir estado pendiente", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"status":"IN_PROGRESS","progress":35}')));
    expect(await getAdapter("meshy").poll?.(credentials, "text:task-1")).toEqual({ kind: "pending", progress: 0.35 });
  });
});