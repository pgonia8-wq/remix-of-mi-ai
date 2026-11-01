import { afterEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { route } from "@/lib/core/router";
import { credentialsFor, execute } from "@/lib/core/executor";
import { searxngAdapter, searxngUrl, parseSearxng } from "@/lib/core/adapters/searxng";
import { canSaveConnection, verifyConnection, type DraftConnection } from "@/lib/core/connection-test";
import type { ModelWithCaps } from "@/lib/core/registry";
import type { JobManager } from "@/lib/core/jobs";
import type { AssetStore } from "@/lib/core/asset-store";

afterEach(() => vi.unstubAllGlobals());
const model = (kind: string, verified = true): ModelWithCaps => ({ id: kind, provider_id: kind, remote_id: "deployment", name: kind, source: "manual", status: "active", favorite: 0, cost_info: null, privacy: "external", context_tokens: null, updated_at: 1, provider_kind: kind, provider_name: kind, provider_enabled: 1, adapter_id: kind, capabilities: ["chat"], tests: verified ? [{ model_id: kind, capability_id: "chat", status: "ok", checked_at: 1, http_status: 200, message: null }] : [] });
const draft: DraftConnection = { adapterId: "searxng", capability: "research.web", credentials: { kind: "searxng", endpoint: "https://search.example.org/private/", apiKey: null, model: "search", deployment: null, apiVersion: null, extraParams: null } };
const response = { results: [{ title: "SearXNG", url: "https://docs.searxng.org/", content: "Documentation" }] };
const stub = (body: unknown, status = 200) => { const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status })); vi.stubGlobal("fetch", fetcher); return fetcher; };

describe("Azure-first, extensible provider routing", () => {
  it("prefers verified Azure over a verified non-Azure favorite in automatic mode", () => {
    const azure = model("azure_openai"), openai = { ...model("openai"), favorite: 1 };
    const decision = route([openai, azure], { capability: "chat", mode: "auto" });
    expect(decision.ok && decision.model.id).toBe("azure_openai");
    expect(decision.ok && decision.alternatives.map(m => m.id)).toEqual(["openai"]);
  });
  it("keeps explicit non-Azure manual selection", () => {
    const decision = route([model("azure_openai"), model("openai")], { capability: "chat", mode: "manual", manualModelId: "openai" });
    expect(decision.ok && decision.model.id).toBe("openai");
  });
  it("keeps favorite mode independent of automatic Azure preference", () => {
    const decision = route([model("azure_openai"), { ...model("openai"), favorite: 1 }], { capability: "chat", mode: "favorite" });
    expect(decision.ok && decision.model.id).toBe("openai");
  });
  it("does not prioritize unverified or disabled Azure over a working provider", () => {
    for (const azure of [model("azure_openai", false), { ...model("azure_openai"), provider_enabled: 0 }]) {
      const decision = route([azure, model("openai")], { capability: "chat", mode: "auto" });
      expect(decision.ok && decision.model.id).toBe("openai");
    }
  });
  it("does not invent Azure music, video or 3D capabilities", () => {
    for (const cap of ["music.generate", "video.generate", "model3d.generate"]) expect(route([{ ...model("azure_openai"), capabilities: [cap] }], { capability: cap, mode: "auto" }).ok).toBe(false);
  });
  it("prefers verified open search while retaining proprietary search as a manual choice", () => {
    const search = (kind: string) => ({ ...model(kind), capabilities: ["research.web"], tests: [{ model_id: kind, capability_id: "research.web", status: "ok" as const, http_status: 200, message: null, checked_at: 1 }] });
    const models = [{ ...search("tavily"), favorite: 1 }, search("searxng")];
    const auto = route(models, { capability: "research.web", mode: "auto" });
    const manual = route(models, { capability: "research.web", mode: "manual", manualModelId: "tavily" });
    expect(auto.ok && auto.model.id).toBe("searxng");
    expect(manual.ok && manual.model.id).toBe("tavily");
  });
  it("rejects unsupported adapter execution before touching secrets or jobs", async () => {
    const unsupported = { ...model("azure_openai"), capabilities: ["video.generate"] };
    const secret = vi.fn(), create = vi.fn();
    const repo = { registry: { listModels: async () => [unsupported], getCapability: async () => null }, getProviderSecret: secret } as unknown as Repo;
    await expect(execute({ repo, jobs: { create } as unknown as JobManager, assets: {} as AssetStore }, "project", unsupported, { capability: "video.generate" })).rejects.toThrow(/No se accedió/);
    expect(secret).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
});

describe("SearXNG on-device contracts (controlled responses, not live validation)", () => {
  it("uses form POST, preserves path prefix, does not leak queries into URL or send keys", async () => {
    const fetcher = stub(response);
    const result = await searxngAdapter.run(draft.credentials, { capability: "research.web", model: "search", prompt: "private question" });
    const [url, init] = (fetcher.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe("https://search.example.org/private/search");
    expect(init.method).toBe("POST");
    expect(new URLSearchParams(String(init.body)).get("q")).toBe("private question");
    expect(new URLSearchParams(String(init.body)).get("format")).toBe("json");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(init.credentials).toBe("omit"); expect(init.redirect).toBe("error");
    expect(result).toMatchObject({ kind: "search", results: response.results.map(r => ({ title: r.title, url: r.url, snippet: r.content })) });
  });
  it("rejects non-HTTPS or credential-bearing instance URLs", () => {
    for (const url of ["http://search.example.org", "https://user:pass@search.example.org", "https://search.example.org?key=secret", "https://search.example.org#fragment"]) expect(() => searxngUrl(url)).toThrow();
    expect(searxngUrl("https://search.example.org/search/")).toBe("https://search.example.org/search");
  });
  it("filters unsafe URLs, deduplicates and applies result limits locally", () => {
    const parsed = parseSearxng({ results: [{ url: "javascript:alert(1)" }, { url: "https://a.example/", content: "a" }, { url: "https://a.example/#fragment" }, { url: "https://b.example/" }] }, 1);
    expect(parsed).toHaveLength(1); expect(parsed[0]?.url).toBe("https://a.example/");
    expect(() => parseSearxng({ answer: "no results schema" })).toThrow();
  });
  it("requires nonempty actual search results and invalidates a changed URL", async () => {
    stub(response);
    const verified = await verifyConnection(draft);
    expect(canSaveConnection(draft, verified)).toBe(true);
    expect(canSaveConnection({ ...draft, credentials: { ...draft.credentials, endpoint: "https://changed.example" } }, verified)).toBe(false);
    stub({ results: [] }); expect(canSaveConnection(draft, await verifyConnection(draft))).toBe(false);
  });
  it("rejects HTML responses and distinguishes disabled JSON and rate limiting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>captcha</html>")));
    expect((await verifyConnection(draft)).ok).toBe(false);
    for (const status of [403, 429]) { stub({}, status); const verified = await verifyConnection(draft); expect(verified.ok).toBe(false); expect(verified.message).toContain(`HTTP ${status}`); }
  });
  it("persists a keyless search provider without adding a chat model", async () => {
    const SQL = await initSqlJs();
    const repo = new Repo(wrapSqlJs(new SQL.Database()), { encrypt: async () => { throw Error("no secret should be stored"); }, decrypt: async () => { throw Error("no secret should be read"); } });
    await repo.migrate();
    const pid = await repo.saveProvider({ kind: "searxng", name: "Search", endpoint: draft.credentials.endpoint ?? "", model: "search" });
    expect(await repo.registry.listModels()).toHaveLength(0);
    const mid = await repo.registry.upsertModel({ providerId: pid, remoteId: "search", source: "manual" });
    await repo.registry.setModelCapabilities(mid, ["research.web"]);
    await repo.migrate();
    const models = await repo.registry.listModels();
    expect(models[0]?.capabilities).toEqual(["research.web"]);
    expect((await credentialsFor(repo, pid)).creds.apiKey).toBeNull();
  });
});