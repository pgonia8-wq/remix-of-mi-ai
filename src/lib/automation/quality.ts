// Quality engine: detects real checks from the project files and runs them on the PC Node. Each result is
// stored as evidence with an explicit status; a check that could not run is "not_run"/"blocked", never "passed".
import { canonical, sha256Hex } from "./approvals";
import { rpc } from "../nodes/client";
import { folders } from "../nodes/storage";
import type { ToolCtx, ToolOut, EvidenceStatus } from "./tools";

export type CheckKind = "build" | "typecheck" | "lint" | "test" | "e2e" | "audit";
export type DetectedCheck = { kind: CheckKind; argv: string[]; tech: string };
/** Pure detection from file list + manifests. */
export function detectChecks(files: string[], manifests: Record<string, string>): DetectedCheck[] {
  const out: DetectedCheck[] = [];
  const pkg = manifests["package.json"] ? (JSON.parse(manifests["package.json"]) as { scripts?: Record<string, string> }) : null;
  if (pkg) {
    const s = pkg.scripts ?? {};
    for (const [k, kinds] of [["build", "build"], ["typecheck", "typecheck"], ["lint", "lint"], ["test", "test"], ["e2e", "e2e"]] as const) if (s[k]) out.push({ kind: kinds, argv: ["npm", "run", k, "--silent"], tech: "node" });
    if (!s["typecheck"] && files.includes("tsconfig.json")) out.push({ kind: "typecheck", argv: ["npx", "--no-install", "tsc", "--noEmit"], tech: "node" });
    out.push({ kind: "audit", argv: ["npm", "audit", "--json", "--omit=dev"], tech: "node" });
  }
  if (files.includes("Cargo.toml")) out.push({ kind: "build", argv: ["cargo", "build"], tech: "rust" }, { kind: "test", argv: ["cargo", "test"], tech: "rust" });
  if (files.includes("go.mod")) out.push({ kind: "build", argv: ["go", "build", "./..."], tech: "go" }, { kind: "test", argv: ["go", "test", "./..."], tech: "go" });
  if (files.some((f) => /(^|\/)(test_.*|.*_test)\.py$/.test(f)) || files.includes("pyproject.toml")) out.push({ kind: "test", argv: ["python3", "-m", "pytest", "-q"], tech: "python" });
  if (files.some((f) => /(^|\/)gradlew$/.test(f) || f === "build.gradle" || f === "build.gradle.kts")) out.push({ kind: "build", argv: ["gradle", "assembleDebug"], tech: "android" }, { kind: "test", argv: ["gradle", "test"], tech: "android" });
  if (files.includes("CMakeLists.txt")) out.push({ kind: "build", argv: ["cmake", "-S", ".", "-B", "build"], tech: "cpp" });
  if (files.includes("foundry.toml")) out.push({ kind: "build", argv: ["forge", "build"], tech: "solidity" }, { kind: "test", argv: ["forge", "test"], tech: "solidity" });
  return out;
}
type JobRunner = (ctx: ToolCtx, argv: string[], cwd: string, opKey: string) => Promise<{ status: string; exitCode: number | null; output: string; isolation: string }>;
export async function runQuality(ctx: ToolCtx, kinds: CheckKind[], runJob: JobRunner): Promise<ToolOut> {
  const f = await folders.get(ctx.core.repo, ctx.projectId, ctx.folderId!);
  if (!f) throw new Error("Carpeta no autorizada");
  const list = await rpc<{ path: string; dir: boolean }[]>(ctx.core.repo, ctx.nodeId!, "fs.list", { rootIndex: f.root_index, projectId: ctx.projectId, path: "" });
  const files = list.filter((x) => !x.dir).map((x) => x.path);
  const manifests: Record<string, string> = {};
  if (files.includes("package.json")) { const r = await rpc<{ data: string }>(ctx.core.repo, ctx.nodeId!, "fs.read", { rootIndex: f.root_index, projectId: ctx.projectId, path: "package.json" }); manifests["package.json"] = new TextDecoder().decode(Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))); }
  const info = JSON.parse((await ctx.core.repo.sql.all<{ info: string }>("SELECT info FROM pc_nodes WHERE id=?", [ctx.nodeId ?? ""]))[0]?.info ?? "{}") as { toolchains?: Record<string, string> };
  const checks = detectChecks(files, manifests);
  const lines: string[] = [];
  for (const kind of kinds) {
    const mine = checks.filter((c) => c.kind === kind);
    if (!mine.length) { await evidence(ctx, kind, "not_run", "", "No se detectó una verificación de este tipo en el proyecto."); lines.push(`${kind}: no ejecutada (no detectada)`); continue; }
    for (const c of mine) {
      if (!info.toolchains?.[c.argv[0]!]) { await evidence(ctx, kind, "blocked", c.argv.join(" "), `${c.argv[0]} no instalado en la PC.`); lines.push(`${kind}: bloqueada (${c.argv[0]} ausente)`); continue; }
      const j = await runJob(ctx, c.argv, "", await sha256Hex(canonical([ctx.runId, ctx.taskId, "quality", c.argv, Date.now()])));
      const status: EvidenceStatus = j.status === "succeeded" ? "passed" : "failed";
      await evidence(ctx, kind, status, c.argv.join(" "), j.output.slice(-8000));
      lines.push(`${kind}: ${status === "passed" ? "aprobada" : "fallida"} (${c.argv.join(" ")}, código ${j.exitCode}, aislamiento ${j.isolation})\n${j.output.slice(-1500)}`);
    }
  }
  return { output: lines.join("\n"), trusted: true };
}
async function evidence(ctx: ToolCtx, kind: string, status: EvidenceStatus, command: string, output: string) {
  await ctx.core.repo.sql.run("INSERT INTO auto_evidence VALUES (?,?,?,?,?,?,?,?,?,?,?)", [crypto.randomUUID(), ctx.projectId, ctx.runId, ctx.taskId, kind, status, command, output, await sha256Hex(output), ctx.nodeId ?? "", Date.now()]);
}
export type Evidence = { id: string; project_id: string; run_id: string; task_id: string | null; check_kind: string; status: EvidenceStatus; command: string; output: string; hash: string; env: string; created_at: number };

/** Pure: self-contained JavaScript test files the phone sandbox can run (no modules, so no package tests). */
export function localTestFiles(files: string[]) {
  return files.filter((f) => /(^|\/)(tests?|__tests__)\/.*\.m?js$|\.(test|spec)\.m?js$/.test(f)).slice(0, 30);
}
/**
 * Phone quality engine: runs self-contained JS tests in the isolated QuickJS worker and records real evidence.
 * Build/typecheck/lint/e2e/audit need real toolchains, so they are recorded as "blocked" — never "passed".
 */
export async function runLocalQuality(ctx: ToolCtx, kinds: CheckKind[]): Promise<ToolOut> {
  const { localWs } = await import("./local-workspace");
  const { runCode } = await import("../code/run");
  const files = (await localWs.list(ctx.core.repo, ctx.projectId)).map((f) => f.path);
  const lines: string[] = [];
  for (const kind of kinds) {
    if (kind !== "test") {
      const why = "Requiere herramientas reales (Node, Gradle, compiladores). Asigna una carpeta en un PC Node (puede estar instalado en tu VM) para ejecutarla.";
      await evidence(ctx, kind, "blocked", kind, why); lines.push(`${kind}: bloqueada en el teléfono — ${why}`); continue;
    }
    const tests = localTestFiles(files);
    if (!tests.length) { await evidence(ctx, kind, "not_run", "", "No hay archivos de prueba .test.js/.spec.js o tests/*.js autocontenidos."); lines.push("test: no ejecutada (sin archivos de prueba)"); continue; }
    for (const path of tests) {
      const source = (await localWs.read(ctx.core.repo, ctx.projectId, path)).text;
      const r = await runCode(source, "", ctx.signal);
      const status: EvidenceStatus = r.ok ? "passed" : "failed";
      const out = r.ok ? r.output : `${r.error}\n${r.output}`;
      await evidence(ctx, kind, status, `quickjs ${path}`, out.slice(-8000));
      lines.push(`test ${path}: ${r.ok ? "aprobada" : "fallida"}\n${out.slice(-1500)}`);
    }
  }
  return { output: lines.join("\n"), trusted: true };
}
