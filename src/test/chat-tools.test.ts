// @vitest-environment node
// Chat tools: streamed tool calls, provider gating, and real local tool execution through invokeTool.
// Provider responses are scripted (no credentials, no cost).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { AssetStore, sqlBlobBackend } from "@/lib/core/asset-store";
import { KeyRing, webBackend } from "@/lib/core/keys";
import { JobManager } from "@/lib/core/jobs";
import { chooseProfile, type DeviceFacts } from "@/lib/core/device-profile";
import type { Core } from "@/lib/core";
import { streamChat, type ProviderCall } from "@/lib/providers";
import { chatToolSet, runChatTool, CHAT_TOOLS } from "@/lib/chat-tools";
import { createRun } from "@/lib/automation/orchestrator";

let core: Core, pid: string;
beforeEach(async () => {
  const SQL = await initSqlJs(), db = wrapSqlJs(new SQL.Database());
  const r = new Repo(db, { encrypt: async (s) => `enc:${s}`, decrypt: async (s) => s.slice(4) }); await r.migrate();
  const mem = new Map<string, string>();
  const keys = new KeyRing(db, webBackend({ get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v); }, del: (k) => { mem.delete(k); } }));
  const device: DeviceFacts = { availMemMB: 500, totalMemMB: 3000, lowMemory: false, cores: 4, abis: [], freeStorageMB: null, batteryPct: null, charging: null, thermal: null, strongBox: false, source: "browser" };
  const profile = chooseProfile(device), files = sqlBlobBackend(db);
  core = { repo: r, keys, files, assets: new AssetStore(db, files, keys, () => profile), jobs: new JobManager(db), profile, device, startup: { temps: 0, orphans: 0, requeued: 0, interrupted: 0, needsUser: 0 } } as Core;
  pid = (await r.createProject("A")).id;
});
afterEach(() => { vi.unstubAllGlobals(); });

const sse = (...events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n");
const azure: ProviderCall = { kind: "azure_openai", endpoint: "https://r.openai.azure.com/openai/v1", apiKey: "unit-test-only", model: "gpt", deployment: "gpt" };

it("sends tools to OpenAI-style chat and assembles streamed tool calls", async () => {
  let body: any = null;
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return sse(
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "image__generate", arguments: "{\"te" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "xt\":\"un gato\"}" } }] } }] },
  ); }));
  const r = await streamChat(azure, [{ role: "user", content: "haz un gato" }], () => {}, undefined, { tools: [{ type: "function", function: { name: "image__generate" } }] });
  expect(body.tools).toHaveLength(1);
  expect(r.toolCalls).toEqual([{ id: "c1", name: "image__generate", arguments: "{\"text\":\"un gato\"}" }]);
});
it("never sends tools or tool turns to providers without that contract", async () => {
  let body: any = null;
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return sse({ type: "content_block_delta", delta: { text: "hola" } }); }));
  await streamChat({ kind: "anthropic", endpoint: null, apiKey: "k", model: "claude" }, [{ role: "user", content: "hola" }, { role: "assistant", content: "", tool_calls: [{ id: "x", name: "a", arguments: "{}" }] }, { role: "tool", content: "r", tool_call_id: "x" }], () => {}, undefined, { tools: [{}] });
  expect(body.tools).toBeUndefined();
  expect(body.messages).toHaveLength(1);
});
it("offers only runnable tools: documents and notes yes, images only with an image model", async () => {
  const set = await chatToolSet(core, pid);
  expect(set.available).toContain("doc.create");
  expect(set.available).toContain("note.save");
  expect(set.available).not.toContain("image.generate");
  expect(set.unavailable.map((u) => u.id)).toContain("image.generate");
  expect(set.available.every((id) => (CHAT_TOOLS as readonly string[]).includes(id))).toBe(true);
});
it("the chat creates a real Word file in the project through the tool gate", async () => {
  const runId = await createRun(core, pid, { goal: "Chat", kind: "chat", limits: { unknownCost: "allow" } });
  const step = await runChatTool(core, pid, runId, { id: "c1", name: "doc__create", arguments: JSON.stringify({ title: "Informe", format: "docx", markdown: "# Informe\n\nHola" }) }, async () => true);
  expect(step.assets).toHaveLength(1);
  expect(step.assets[0]!.name).toBe("Informe.docx");
  const bytes = await core.assets.read(pid, step.assets[0]!.id);
  expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");
});
it("tools outside the chat allowlist are refused", async () => {
  const runId = await createRun(core, pid, { goal: "Chat", kind: "chat" });
  const step = await runChatTool(core, pid, runId, { id: "c2", name: "shell__exec", arguments: "{\"argv\":[\"rm\"]}" }, async () => true);
  expect(step.reply).toMatch(/no está disponible/);
  expect(step.assets).toEqual([]);
});
