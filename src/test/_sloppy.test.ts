// @vitest-environment node
// Chat/phone tools: every chat tool is registered, file tools and engines really run on the phone workspace
// (7-Zip WASM, sql.js, diff, hashes, CAD), and gates (approvals, roles, https-only) hold. No provider is called.
import { beforeEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { AssetStore, sqlBlobBackend } from "@/lib/core/asset-store";
import { KeyRing, webBackend } from "@/lib/core/keys";
import { JobManager } from "@/lib/core/jobs";
import { chooseProfile, type DeviceFacts } from "@/lib/core/device-profile";
import type { Core } from "@/lib/core";
import { invokeTool, getTool, DEFAULT_LIMITS, type ToolCtx } from "@/lib/automation/tools";
import { createRun } from "@/lib/automation/orchestrator";
import { localWs } from "@/lib/automation/local-workspace";
import { applyEdits, indexSymbols } from "@/lib/automation/phone-tools";
import { createArchive, extractArchive } from "@/lib/archive";
import { CHAT_TOOLS } from "@/lib/chat-tools";

let repo: Repo, core: Core, p: string, ctx: ToolCtx;
const opts = (op: string) => ({ allowed: [...CHAT_TOOLS], limits: { ...DEFAULT_LIMITS, maxCalls: 300, perAgentCalls: 300, unknownCost: "allow" as const }, opKey: op });
let n = 0;
const call = (tool: string, input: unknown) => invokeTool(ctx, tool, input, opts(`t${n++}`));
const okOut = async (tool: string, input: unknown) => { const r = await call(tool, input); if (r.status !== "ok") throw new Error(`${tool}: ${JSON.stringify(r)}`); return r; };

beforeEach(async () => {
  const SQL = await initSqlJs(), db = wrapSqlJs(new SQL.Database());
  repo = new Repo(db, { encrypt: async (s) => `enc:${s}`, decrypt: async (s) => s.slice(4) }); await repo.migrate();
  const mem = new Map<string, string>();
  const keys = new KeyRing(db, webBackend({ get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v); }, del: (k) => { mem.delete(k); } }));
  const device: DeviceFacts = { availMemMB: 500, totalMemMB: 3000, lowMemory: false, cores: 4, abis: [], freeStorageMB: null, batteryPct: null, charging: null, thermal: null, strongBox: false, source: "browser" };
  const profile = chooseProfile(device), files = sqlBlobBackend(db), assets = new AssetStore(db, files, keys, () => profile);
  core = { repo, keys, files, assets, jobs: new JobManager(db), profile, device, startup: { temps: 0, orphans: 0, requeued: 0, interrupted: 0, needsUser: 0 } } as Core;
  p = (await repo.createProject("A")).id;
  const runId = await createRun(core, p, { goal: "chat", kind: "chat", limits: { maxCalls: 300 } });
  ctx = { core, projectId: p, runId, taskId: null, agent: "chat" };
});


it("entradas como las de DeepSeek", async () => {
  const res: Record<string, string> = {};
  const t = async (tool: string, input: unknown) => { const r = await call(tool, input); res[tool + " " + JSON.stringify(input).slice(0, 60)] = r.status === "ok" ? "OK " + r.output.slice(0, 80) : JSON.stringify(r).slice(0, 300); return r; };
  await t("fs.write", { path: "/notas/a.txt", content: "hola mundo", baseHash: null });
  await t("fs.write", { path: "notas/b.txt", content: "hola" });
  await t("fs.patch", { path: "/notas/a.txt", edits: [{ find: "mundo", replace: "MUNDO", all: null }] });
  await t("fs.move", { from: "notas/b.txt", to: "notas/c.txt", copy: null });
  await t("fs.versions", { path: "notas/a.txt", restore: null });
  await t("ws.snapshot", { label: "antes" });
  const doc = await t("doc.create", { title: "Informe", format: "docx", markdown: "# Hola\n\nTexto" });
  const docId = doc.status === "ok" ? (doc.assets?.[0]?.id ?? "") : "";
  await t("doc.read", { assetId: docId });
  await t("doc.outline", { assetId: docId });
  await t("doc.edit", { assetId: docId, ops: [{ op: "replace", find: "Texto", text: "Nuevo", replace: "Nuevo" }] });
  await t("ws.snapshot", { label: "despues" });
  const snaps = await t("assets.list", {});
  await t("qr.generate", { text: "https://example.com" });
  await t("sheet.compute", { cells: { A1: 10, A2: 20, A3: "=SUM(A1:A2)" } });
  const ar = await t("archive.create", { format: "zip", name: "pack", paths: ["notas/a.txt"], assetIds: null, all: null });
  const arId = ar.status === "ok" ? (ar.assets?.[0]?.id ?? "") : "";
  await t("archive.extract", { assetId: arId, into: "x" });
  await t("files.export", { paths: ["notas/a.txt"], name: null });
  await t("files.attach", { assetId: arId });
  await t("cad.create", { shape: "box", size: [10, 10, 10] });
  await t("quality.run", { checks: ["test"] });
  console.log(JSON.stringify(res, null, 1));
}, 120000);
