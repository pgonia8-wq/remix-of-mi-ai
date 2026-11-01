// Universal Tool Manager. Every tool call — native tool calling or JSON decisions — goes through invokeTool():
// registry → task/agent allowlist → project policy → input schema → call limits → budget → availability →
// exact-action approval → idempotent checkpoint → execution → observation log. Model output never grants permissions.
import { z } from "zod";
import type { Core } from "../core";
import { execute } from "../core/executor";
import { route } from "../core/router";
import { notes, tasks } from "../core/productivity";
import { estimateCost } from "../core/costs";
import { rpc, nodes } from "../nodes/client";
import { folders, pcFiles } from "../nodes/storage";
import { tunnels } from "../nodes/tunnels";
import { approvals, canonical, fingerprintAction, sha256Hex } from "./approvals";
import { workingMemory } from "./working-memory";
import { scrubSecrets } from "../db/repo";

export type Family = "ia" | "investigacion" | "ingenieria" | "desarrollo" | "infraestructura" | "datos" | "multimedia" | "productividad";
export type Permission = "provider" | "network" | "local.write" | "pc.read" | "pc.write" | "pc.exec" | "remote" | "tunnel" | "memory" | "sensitive";
export type Risk = "low" | "medium" | "high";
export type ToolCtx = { core: Core; projectId: string; runId: string; taskId: string | null; agent: string; nodeId?: string | null; folderId?: string | null; signal?: AbortSignal; opKey?: string };
export type ToolOut = { output: string; trusted: boolean; evidence?: { kind: string; status: EvidenceStatus; command: string; output: string }; costUsd?: number | null };
export type EvidenceStatus = "passed" | "failed" | "not_run" | "blocked" | "simulated";
export type ToolDef = {
  id: string; name: string; description: string; family: Family; input: z.ZodTypeAny; output: string;
  permissions: Permission[]; network: boolean; cost: "none" | "provider" | "unknown"; capability?: string;
  maxCalls: number; timeoutMs: number; parallel: boolean; env: ("android" | "sandbox" | "pc" | "vm")[]; risk: Risk;
  approval: "never" | "always" | "if-cost"; sideEffect: boolean; roles: string[] | "all";
  target?: (input: any, ctx: ToolCtx) => string;
  availability: (ctx: ToolCtx) => Promise<{ ok: boolean; reason?: string }>;
  run?: (ctx: ToolCtx, input: any) => Promise<ToolOut>;
};
export class ToolRejected extends Error {}

const text = (max = 12_000) => z.object({ text: z.string().min(1).max(max) }).strict();
const relPath = z.string().min(1).max(400).refine((s) => !s.startsWith("/") && !s.split(/[\\/]/).includes(".."), "Ruta fuera del proyecto");
const ok = async () => ({ ok: true });
const modelFor = async (ctx: ToolCtx, capability: string) => {
  const d = route(await ctx.core.repo.registry.listModels(), { capability, mode: "auto" });
  return d.ok ? { ok: true as const, model: d.model } : { ok: false as const, reason: d.reason };
};
const providerAvail = (capability: string) => async (ctx: ToolCtx) => { const m = await modelFor(ctx, capability); return m.ok ? { ok: true } : { ok: false, reason: m.reason }; };
const providerRun = (capability: string) => async (ctx: ToolCtx, i: { text: string }): Promise<ToolOut> => {
  const m = await modelFor(ctx, capability); if (!m.ok) throw new ToolRejected(m.reason);
  const r = await execute(ctx.core, ctx.projectId, m.model, { capability, prompt: i.text, saveText: true, ...(ctx.signal ? { signal: ctx.signal } : {}) });
  if (r.pending) return { output: `Trabajo remoto ${r.jobId} en curso; revisar en Trabajos.`, trusted: true };
  const body = r.text ?? (r.results ? r.results.map((x) => `${x.title}\n${x.url}\n${x.snippet}`).join("\n\n") : r.assets.map((a) => `Archivo ${a.name ?? a.id} (${a.mime})`).join("\n"));
  return { output: body.slice(0, 20_000), trusted: false };
};
async function nodeReady(ctx: ToolCtx, toolchain?: string) {
  if (!ctx.nodeId) return { ok: false, reason: "No hay PC Node asignado a esta ejecución." };
  const n = await nodes.get(ctx.core.repo, ctx.nodeId);
  if (!n || n.revoked) return { ok: false, reason: "PC Node revocado o inexistente." };
  if (n.status !== "online") return { ok: false, reason: "PC Node desconectado." };
  if (toolchain) { const info = JSON.parse(n.info || "{}") as { toolchains?: Record<string, string> }; if (!info.toolchains?.[toolchain]) return { ok: false, reason: `${toolchain} no está instalado en la PC.` }; }
  return { ok: true };
}
async function folderReady(ctx: ToolCtx) {
  const n = await nodeReady(ctx); if (!n.ok) return n;
  if (!ctx.folderId) return { ok: false, reason: "No hay carpeta autorizada para este proyecto." };
  const f = await folders.get(ctx.core.repo, ctx.projectId, ctx.folderId);
  return f && f.node_id === ctx.nodeId ? { ok: true } : { ok: false, reason: "Carpeta ajena al proyecto o al nodo." };
}
async function folderOf(ctx: ToolCtx) { const f = await folders.get(ctx.core.repo, ctx.projectId, ctx.folderId!); if (!f) throw new ToolRejected("Carpeta no autorizada"); return f; }
async function runJob(ctx: ToolCtx, argv: string[], cwd: string, opKey: string, extra: Record<string, unknown> = {}) {
  const f = await folderOf(ctx);
  const s = await rpc<{ jobId: string; isolation: string }>(ctx.core.repo, ctx.nodeId!, "job.start", { argv, cwd, rootIndex: f.root_index, projectId: ctx.projectId, opKey, timeoutMs: 600_000, ...extra });
  for (let i = 0; i < 1200; i++) {
    const j = await rpc<{ status: string; exitCode: number | null; output: string; isolation: string; truncated: boolean }>(ctx.core.repo, ctx.nodeId!, "job.status", { jobId: s.jobId });
    if (j.status !== "running") return { ...j, jobId: s.jobId };
    if (ctx.signal?.aborted) { await rpc(ctx.core.repo, ctx.nodeId!, "job.cancel", { jobId: s.jobId }); throw new ToolRejected("Cancelado"); }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new ToolRejected("El trabajo sigue en curso; revisa su estado en el nodo.");
}
const execInput = z.object({ argv: z.array(z.string().max(2000)).min(1).max(64), cwd: z.string().max(400).default(""), network: z.boolean().default(false) }).strict()
  .refine((v) => !v.cwd.startsWith("/") && !v.cwd.split(/[\\/]/).includes(".."), "Directorio fuera del proyecto");
const execTool = (id: string, name: string, family: Family, bin: string | null, roles: string[] | "all"): ToolDef => ({
  id, name, description: bin ? `Ejecuta ${bin} en el espacio del proyecto en la PC.` : "Ejecuta un proceso autorizado (sin shell) en el espacio del proyecto en la PC.",
  family, input: bin ? execInput.refine((v) => v.argv[0] === bin, `Solo ${bin}`) : execInput, output: "salida y código de salida", permissions: ["pc.exec"], network: false, cost: "none",
  maxCalls: 40, timeoutMs: 600_000, parallel: true, env: ["pc", "vm"], risk: "medium", approval: "always", sideEffect: true, roles,
  target: (i, ctx) => `${ctx.nodeId}:${i.cwd || "."}:${i.argv.join(" ")}${i.network ? " (con red)" : ""}`,
  availability: (ctx) => nodeReady(ctx, bin ?? undefined).then((r) => r.ok ? folderReady(ctx) : r),
  run: async (ctx, i) => {
    if (i.argv[0] === "git" && ["push", "remote"].includes(i.argv[1])) throw new ToolRejected("Use repo.push, que exige su propia aprobación.");
    // Per-turn key: a repeated identical command (e.g. re-running tests after a fix) is a new operation.
    const opKey = await sha256Hex(canonical([ctx.runId, ctx.opKey ?? ctx.taskId, i]));
    const j = await runJob(ctx, i.argv, i.cwd, opKey, { network: i.network });
    const status: EvidenceStatus = j.status === "succeeded" ? "passed" : "failed";
    return { output: `estado=${j.status} código=${j.exitCode} aislamiento=${j.isolation}\n${j.output}`.slice(0, 20_000), trusted: true, evidence: { kind: "exec", status, command: i.argv.join(" "), output: j.output.slice(-8000) } };
  },
});
const declared = (id: string, name: string, family: Family, reason: string, permissions: Permission[] = ["remote"]): ToolDef => ({
  id, name, description: name, family, input: z.object({}).passthrough(), output: "—", permissions, network: true, cost: "unknown", maxCalls: 0, timeoutMs: 0,
  parallel: false, env: ["android"], risk: "high", approval: "always", sideEffect: true, roles: "all", availability: async () => ({ ok: false, reason }),
});
const provider = (id: string, name: string, family: Family, capability: string, roles: string[] | "all" = "all", max = 12_000): ToolDef => ({
  id, name, description: `${name} con el modelo verificado que declare «${capability}».`, family, input: text(max), output: "texto o archivo", permissions: ["provider", "network"],
  network: true, cost: "provider", capability, maxCalls: 20, timeoutMs: 180_000, parallel: true, env: ["android"], risk: "low", approval: "if-cost", sideEffect: false, roles,
  availability: providerAvail(capability), run: providerRun(capability),
});
const LANGS: [string, string, string][] = [["dev.node", "Node.js / npm", "node"], ["dev.npm", "npm", "npm"], ["dev.npx", "npx (TypeScript, frameworks)", "npx"], ["dev.python", "Python", "python3"], ["dev.pip", "pip", "pip"], ["dev.java", "Java", "java"], ["dev.kotlin", "Kotlin", "kotlinc"], ["dev.gradle", "Gradle / Android", "gradle"], ["dev.gcc", "C (GCC)", "gcc"], ["dev.clang", "C/C++ (Clang)", "clang"], ["dev.cmake", "CMake", "cmake"], ["dev.ninja", "Ninja", "ninja"], ["dev.rust", "Rust", "rustc"], ["dev.cargo", "Cargo", "cargo"], ["dev.go", "Go", "go"], ["dev.dotnet", "C# / .NET", "dotnet"], ["dev.sqlite", "SQLite", "sqlite3"], ["dev.postgres", "PostgreSQL (psql)", "psql"], ["dev.foundry", "Solidity (Foundry)", "forge"]];
const ENG = ["architect", "frontend", "backend", "database", "infra", "security", "tester", "integrator", "debugger", "auditor", "coordinator"];

export const TOOL_REGISTRY: ToolDef[] = [
  // A. IA
  provider("ai.chat", "Chat con modelo", "ia", "chat"),
  provider("ai.reasoning", "Razonamiento", "ia", "reasoning"),
  provider("ai.vision", "Visión", "multimedia", "vision"),
  { ...provider("ai.evaluate", "Evaluación de resultados", "ia", "chat"), description: "Pide a otro modelo evaluar un resultado; su opinión es dato, no prueba." },
  // B. Investigación
  { ...provider("research.web", "Búsqueda web (SearXNG/Tavily)", "investigacion", "research.web", "all", 500), approval: "never" },
  { id: "research.deep", name: "Investigación profunda", description: "Búsqueda multironda con lectura de fuentes y citas.", family: "investigacion", input: text(2000), output: "informe con fuentes", permissions: ["provider", "network"], network: true, cost: "provider", maxCalls: 3, timeoutMs: 600_000, parallel: false, env: ["android"], risk: "low", approval: "if-cost", sideEffect: false, roles: "all",
    availability: providerAvail("research.web"), run: async (ctx, i) => { const { runResearch } = await import("../core/research"); const r = await runResearch(ctx.core, ctx.projectId, i.text, { deep: true }); return { output: `${r.report}\n\nFuentes:\n${r.sources.map((s, n) => `[${n + 1}] ${s.url} ${s.read ? "(leída)" : "(fragmento)"}`).join("\n")}`.slice(0, 20_000), trusted: false }; } },
  declared("research.browser", "Navegación web automatizada", "investigacion", "Requiere un navegador controlado; no incluido en el teléfono. Use el PC Node con Playwright instalado mediante dev.npx."),
  // C/D. Ingeniería y desarrollo (PC Node)
  { id: "fs.list", name: "Listar archivos", description: "Lista el espacio del proyecto en la PC.", family: "ingenieria", input: z.object({ path: z.string().max(400).default("") }).strict(), output: "lista", permissions: ["pc.read"], network: false, cost: "none", maxCalls: 60, timeoutMs: 30_000, parallel: true, env: ["pc"], risk: "low", approval: "never", sideEffect: false, roles: "all",
    availability: folderReady, run: async (ctx, i) => { const r = await pcFiles.list(ctx.core.repo, ctx.projectId, ctx.folderId!, i.path); return { output: JSON.stringify(r.files.slice(0, 500)), trusted: true }; } },
  { id: "fs.read", name: "Leer archivo", description: "Lee un archivo del proyecto con verificación de hash.", family: "ingenieria", input: z.object({ path: relPath }).strict(), output: "contenido", permissions: ["pc.read"], network: false, cost: "none", maxCalls: 120, timeoutMs: 30_000, parallel: true, env: ["pc"], risk: "low", approval: "never", sideEffect: false, roles: "all",
    availability: folderReady, run: async (ctx, i) => { const r = await pcFiles.read(ctx.core.repo, ctx.projectId, ctx.folderId!, i.path); return { output: `hash=${r.hash}\n${new TextDecoder().decode(r.bytes).slice(0, 30_000)}`, trusted: false }; } },
  { id: "fs.write", name: "Escribir archivo", description: "Escribe en el proyecto; exige el hash de la versión editada (null si es nuevo) y respeta bloqueos.", family: "ingenieria", input: z.object({ path: relPath, content: z.string().max(400_000), baseHash: z.string().regex(/^[0-9a-f]{64}$/).nullable() }).strict(), output: "hash nuevo o conflicto", permissions: ["pc.write"], network: false, cost: "none", maxCalls: 200, timeoutMs: 30_000, parallel: true, env: ["pc"], risk: "low", approval: "never", sideEffect: true, roles: ENG.concat("documenter", "analyst"),
    availability: folderReady, run: async (ctx, i) => {
      await assertLock(ctx, i.path);
      const r = await pcFiles.write(ctx.core.repo, ctx.projectId, ctx.folderId!, i.path, new TextEncoder().encode(i.content), i.baseHash);
      if (r.conflict) return { output: `CONFLICTO: el archivo cambió (hash actual ${r.currentHash}). Lee de nuevo y combina.`, trusted: true };
      await workingMemory.add(ctx.core.repo, ctx.projectId, ctx.runId, "file", `${i.path} → ${r.hash}`);
      await ctx.core.repo.sql.run("INSERT INTO auto_observations VALUES (?,?,?,?,?,'file','fs.write',?,?,1,NULL,0,0,?)", [crypto.randomUUID(), ctx.projectId, ctx.runId, ctx.taskId, ctx.agent, i.path, r.hash, Date.now()]);
      return { output: `escrito ${i.path} hash=${r.hash}`, trusted: true };
    } },
  { id: "fs.delete", name: "Eliminar archivo", description: "Elimina guardando una versión recuperable.", family: "ingenieria", input: z.object({ path: relPath }).strict(), output: "versión previa", permissions: ["pc.write"], network: false, cost: "none", maxCalls: 30, timeoutMs: 30_000, parallel: false, env: ["pc"], risk: "medium", approval: "always", sideEffect: true, roles: ENG,
    target: (i, ctx) => `${ctx.folderId}:${i.path}`, availability: folderReady, run: async (ctx, i) => { await assertLock(ctx, i.path); await pcFiles.remove(ctx.core.repo, ctx.projectId, ctx.folderId!, i.path); return { output: `eliminado ${i.path} (versión conservada)`, trusted: true }; } },
  { id: "fs.search", name: "Buscar en el código", description: "Busca texto en los archivos del proyecto.", family: "ingenieria", input: z.object({ query: z.string().min(1).max(200) }).strict(), output: "coincidencias", permissions: ["pc.read"], network: false, cost: "none", maxCalls: 60, timeoutMs: 60_000, parallel: true, env: ["pc"], risk: "low", approval: "never", sideEffect: false, roles: "all",
    availability: folderReady, run: async (ctx, i) => { const f = await folderOf(ctx); const r = await rpc<unknown[]>(ctx.core.repo, ctx.nodeId!, "fs.search", { rootIndex: f.root_index, projectId: ctx.projectId, query: i.query }); return { output: JSON.stringify(r).slice(0, 20_000), trusted: false }; } },
  { id: "fs.versions", name: "Versiones de archivo", description: "Lista y recupera versiones anteriores.", family: "ingenieria", input: z.object({ path: relPath, restore: z.string().regex(/^\d+-[0-9a-f]{12}$/).optional() }).strict(), output: "versiones", permissions: ["pc.write"], network: false, cost: "none", maxCalls: 30, timeoutMs: 30_000, parallel: false, env: ["pc"], risk: "medium", approval: "never", sideEffect: true, roles: ENG,
    availability: folderReady, run: async (ctx, i) => i.restore ? { output: JSON.stringify(await pcFiles.restore(ctx.core.repo, ctx.projectId, ctx.folderId!, i.path, i.restore)), trusted: true } : { output: JSON.stringify(await pcFiles.versions(ctx.core.repo, ctx.projectId, ctx.folderId!, i.path)), trusted: true } },
  execTool("shell.exec", "Terminal (proceso sin shell)", "ingenieria", null, ENG),
  execTool("git", "Git local (estado, ramas, commits, diffs, versiones)", "ingenieria", "git", ENG.concat("documenter")),
  ...LANGS.map(([id, name, bin]) => execTool(id, name, "desarrollo", bin, ENG)),
  { id: "repo.push", name: "Publicar en repositorio remoto", description: "git push: siempre requiere aprobación expresa.", family: "ingenieria", input: z.object({ remote: z.string().regex(/^[\w.-]{1,60}$/), branch: z.string().regex(/^[\w./-]{1,120}$/) }).strict(), output: "resultado", permissions: ["remote", "network"], network: true, cost: "none", maxCalls: 3, timeoutMs: 120_000, parallel: false, env: ["pc"], risk: "high", approval: "always", sideEffect: true, roles: ["integrator", "coordinator"],
    target: (i, ctx) => `${ctx.nodeId}:${i.remote}/${i.branch}`, availability: (ctx) => nodeReady(ctx, "git").then((r) => r.ok ? folderReady(ctx) : r),
    run: async (ctx, i) => { const j = await runJob(ctx, ["git", "push", i.remote, i.branch], "", await sha256Hex(canonical([ctx.runId, ctx.opKey ?? "push", "push", i])), { remoteApproved: true, network: true }); return { output: `estado=${j.status}\n${j.output}`, trusted: true }; } },
  { id: "quality.run", name: "Verificación de calidad", description: "Ejecuta compilación, tipos, lint, pruebas y auditoría de dependencias detectadas.", family: "ingenieria", input: z.object({ checks: z.array(z.enum(["build", "typecheck", "lint", "test", "e2e", "audit"])).min(1).max(6) }).strict(), output: "evidencias", permissions: ["pc.exec"], network: false, cost: "none", maxCalls: 20, timeoutMs: 1_800_000, parallel: false, env: ["pc"], risk: "medium", approval: "always", sideEffect: true, roles: ["tester", "auditor", "debugger", "integrator", "security"],
    target: (i, ctx) => `${ctx.nodeId}:${i.checks.join(",")}`, availability: folderReady,
    run: async (ctx, i) => { const { runQuality } = await import("./quality"); return runQuality(ctx, i.checks, runJob); } },
  { id: "code.js", name: "JavaScript ligero aislado (QuickJS)", description: "Evalúa JavaScript sin red, almacenamiento ni claves.", family: "desarrollo", input: z.object({ source: z.string().min(1).max(60_000), input: z.string().max(60_000).default("") }).strict(), output: "salida", permissions: [], network: false, cost: "none", maxCalls: 30, timeoutMs: 10_000, parallel: true, env: ["sandbox"], risk: "low", approval: "never", sideEffect: false, roles: "all",
    availability: async () => typeof Worker === "undefined" ? { ok: false, reason: "Este entorno no tiene workers para el sandbox." } : { ok: true },
    run: async (_c, i) => { const { runCode } = await import("../code/run"); const r = await runCode(i.source, i.input); return { output: r.ok ? r.output : `Error: ${r.error}`, trusted: true, evidence: { kind: "exec", status: r.ok ? "passed" : "failed", command: "quickjs", output: (r.output || r.error || "").slice(0, 4000) } }; } },
  // E. Infraestructura
  { id: "node.info", name: "Recursos de la PC", description: "CPU, RAM, discos, aislamiento y toolchains reales.", family: "infraestructura", input: z.object({}).strict(), output: "JSON", permissions: ["pc.read"], network: false, cost: "none", maxCalls: 20, timeoutMs: 10_000, parallel: true, env: ["pc"], risk: "low", approval: "never", sideEffect: false, roles: "all",
    availability: (ctx) => nodeReady(ctx), run: async (ctx) => ({ output: JSON.stringify(await rpc(ctx.core.repo, ctx.nodeId!, "info", {})), trusted: true }) },
  { id: "tunnel.open", name: "Abrir túnel de desarrollo", description: "Túnel temporal hacia un destino permitido en la PC.", family: "infraestructura", input: z.object({ target: z.string().max(260), ttlMinutes: z.number().int().min(1).max(120) }).strict(), output: "puerto", permissions: ["tunnel", "network"], network: true, cost: "none", maxCalls: 5, timeoutMs: 30_000, parallel: false, env: ["pc"], risk: "high", approval: "always", sideEffect: true, roles: ["infra", "coordinator", "tester"],
    target: (i, ctx) => `${ctx.nodeId}→${i.target} ${i.ttlMinutes}min`, availability: (ctx) => nodeReady(ctx),
    run: async (ctx, i) => { const id = await tunnels.open(ctx.core.repo, ctx.projectId, { nodeId: ctx.nodeId!, target: i.target, ttlMs: i.ttlMinutes * 60_000, agent: ctx.agent }); return { output: `túnel ${id}`, trusted: true }; } },
  { id: "tunnel.close", name: "Cerrar túnel", description: "Cierra un túnel del proyecto.", family: "infraestructura", input: z.object({ id: z.string().uuid() }).strict(), output: "estado", permissions: ["tunnel"], network: false, cost: "none", maxCalls: 10, timeoutMs: 30_000, parallel: false, env: ["pc"], risk: "low", approval: "never", sideEffect: true, roles: "all",
    availability: ok, run: async (ctx, i) => { await tunnels.close(ctx.core.repo, ctx.projectId, i.id); return { output: "cerrado", trusted: true }; } },
  declared("ssh.exec", "SSH remoto", "infraestructura", "Disponible desde Servidores con confirmación nativa por comando; los agentes solo pueden preparar el comando."),
  declared("sftp.transfer", "SFTP", "infraestructura", "Disponible desde Servidores con confirmación nativa; no delegable a agentes."),
  declared("docker.manage", "Docker", "infraestructura", "Docker se usa como aislamiento del PC Node; administrarlo directamente no está permitido a los agentes."),
  declared("vm.connect", "Máquina virtual", "infraestructura", "Conecta una VM como servidor SSH o instala allí el PC Node."),
  // F. Datos
  { id: "data.sql", name: "SQL sobre SQLite del proyecto (solo lectura)", description: "Consulta de solo lectura sobre una base SQLite del espacio del proyecto en la PC.", family: "datos", input: z.object({ db: relPath, query: z.string().min(1).max(4000).refine((q) => /^\s*(select|with|pragma table_info)\b/i.test(q) && !/;\s*\S/.test(q), "Solo lectura y una sentencia") }).strict(), output: "filas", permissions: ["pc.exec"], network: false, cost: "none", maxCalls: 40, timeoutMs: 60_000, parallel: true, env: ["pc"], risk: "low", approval: "never", sideEffect: false, roles: "all",
    availability: (ctx) => nodeReady(ctx, "sqlite3").then((r) => r.ok ? folderReady(ctx) : r),
    run: async (ctx, i) => { const j = await runJob(ctx, ["sqlite3", "-readonly", "-json", i.db, i.query], "", await sha256Hex(canonical([ctx.runId, ctx.opKey ?? ctx.taskId, "sql", i]))); return { output: j.output.slice(0, 20_000), trusted: false }; } },
  // G. Multimedia
  provider("image.generate", "Generar imagen", "multimedia", "image.generate"),
  provider("audio.tts", "Voz", "multimedia", "audio.tts"),
  provider("video.generate", "Generar video", "multimedia", "video.generate"),
  declared("media.ocr", "OCR", "multimedia", "OCR local disponible en Documentos; requiere archivo elegido por el usuario.", ["local.write"]),
  // H. Productividad
  { id: "note.save", name: "Guardar nota", description: "Guarda una nota del proyecto.", family: "productividad", input: z.object({ title: z.string().min(1).max(200), body: z.string().max(60_000) }).strict(), output: "id", permissions: ["local.write"], network: false, cost: "none", maxCalls: 20, timeoutMs: 5000, parallel: true, env: ["android"], risk: "low", approval: "never", sideEffect: true, roles: "all",
    availability: ok, run: async (ctx, i) => { await notes.save(ctx.core.repo.sql, ctx.projectId, { title: i.title, body: i.body }); return { output: "nota guardada", trusted: true }; } },
  { id: "task.add", name: "Crear tarea", description: "Crea una tarea del proyecto.", family: "productividad", input: z.object({ title: z.string().min(1).max(500) }).strict(), output: "id", permissions: ["local.write"], network: false, cost: "none", maxCalls: 20, timeoutMs: 5000, parallel: true, env: ["android"], risk: "low", approval: "never", sideEffect: true, roles: "all",
    availability: ok, run: async (ctx, i) => { await tasks.add(ctx.core.repo.sql, ctx.projectId, { title: i.title }); return { output: "tarea creada", trusted: true }; } },
  { id: "memory.search", name: "Consultar memoria del proyecto", description: "Recupera contexto de la memoria del proyecto.", family: "productividad", input: text(500), output: "contexto", permissions: ["memory"], network: false, cost: "none", maxCalls: 20, timeoutMs: 10_000, parallel: true, env: ["android"], risk: "low", approval: "never", sideEffect: false, roles: "all",
    availability: ok, run: async (ctx, i) => ({ output: (await ctx.core.repo.buildContext(ctx.projectId, i.text)).slice(0, 12_000), trusted: false }) },
  { id: "memory.save", name: "Guardar en memoria del proyecto", description: "Agrega un hecho a la memoria del proyecto.", family: "productividad", input: text(2000), output: "ok", permissions: ["memory", "local.write"], network: false, cost: "none", maxCalls: 10, timeoutMs: 5000, parallel: false, env: ["android"], risk: "medium", approval: "always", sideEffect: true, roles: "all",
    target: (i) => i.text.slice(0, 120), availability: ok, run: async (ctx, i) => { await ctx.core.repo.addMemory(ctx.projectId, "hecho", i.text); return { output: "guardado", trusted: true }; } },
  { id: "reminder.add", name: "Recordatorio de revisión", description: "Programa una alarma que solo abre la revisión.", family: "productividad", input: z.object({ minutes: z.number().int().min(1).max(60 * 24 * 30), note: z.string().max(300) }).strict(), output: "id", permissions: ["local.write"], network: false, cost: "none", maxCalls: 5, timeoutMs: 5000, parallel: false, env: ["android"], risk: "low", approval: "never", sideEffect: true, roles: "all",
    availability: ok, run: async (ctx, i) => { const { scheduleReview } = await import("./triggers"); const id = await scheduleReview(ctx.core.repo, ctx.projectId, ctx.runId, Date.now() + i.minutes * 60_000, "reminder", i.note); return { output: `recordatorio ${id}`, trusted: true }; } },
];
export const TOOL_IDS = TOOL_REGISTRY.map((t) => t.id);
export const getTool = (id: string) => TOOL_REGISTRY.find((t) => t.id === id) ?? null;
export async function availabilityReport(ctx: ToolCtx) {
  return Promise.all(TOOL_REGISTRY.map(async (t) => ({ id: t.id, name: t.name, family: t.family, risk: t.risk, approval: t.approval, ...(await t.availability(ctx).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }))) })));
}

async function assertLock(ctx: ToolCtx, path: string) {
  // Undeclared files are locked on first write, so two tasks can never edit the same file concurrently.
  if (ctx.taskId) await ctx.core.repo.sql.run("INSERT OR IGNORE INTO file_locks VALUES (?,?,?,?,?)", [ctx.projectId, path, ctx.runId, ctx.taskId, Date.now()]);
  const [l] = await ctx.core.repo.sql.all<{ task_id: string; run_id: string }>("SELECT task_id, run_id FROM file_locks WHERE project_id=? AND path=?", [ctx.projectId, path]);
  if (l && (l.run_id !== ctx.runId || l.task_id !== ctx.taskId)) throw new ToolRejected(`Archivo bloqueado por otra subtarea (${l.task_id}).`);
}
export const fileLocks = {
  /** All-or-nothing acquisition of the files a task declared; prevents concurrent edits of one file. */
  async acquire(core: Core, p: string, runId: string, taskId: string, paths: string[]) {
    const held = await core.repo.sql.all<{ path: string; task_id: string }>(`SELECT path, task_id FROM file_locks WHERE project_id=? AND path IN (${paths.map(() => "?").join(",") || "''"})`, [p, ...paths]);
    if (held.some((h) => h.task_id !== taskId)) return false;
    for (const path of paths) await core.repo.sql.run("INSERT OR IGNORE INTO file_locks VALUES (?,?,?,?,?)", [p, path, runId, taskId, Date.now()]);
    return true;
  },
  release(core: Core, p: string, taskId: string) { return core.repo.sql.run("DELETE FROM file_locks WHERE project_id=? AND task_id=?", [p, taskId]); },
};

export type Limits = { maxUsd: number | null; maxCalls: number; maxTokens: number; maxMs: number; concurrency: number; maxTurnsPerTask: number; perAgentCalls: number; perToolCalls: Record<string, number>; unknownCost: "ask" | "deny" | "allow"; maxReplans: number };
export const DEFAULT_LIMITS: Limits = { maxUsd: null, maxCalls: 60, maxTokens: 400_000, maxMs: 6 * 3600_000, concurrency: 2, maxTurnsPerTask: 12, perAgentCalls: 30, perToolCalls: {}, unknownCost: "ask", maxReplans: 2 };
export type InvokeResult = { status: "ok"; output: string; trusted: boolean } | { status: "approval"; approvalId: string; summary: string } | { status: "review"; reason: string } | { status: "rejected"; reason: string };

/** The single gate for every tool call. */
export async function invokeTool(ctx: ToolCtx, toolId: string, raw: unknown, opts: { allowed: string[]; limits: Limits; opKey: string }): Promise<InvokeResult> {
  const { repo } = ctx.core, p = ctx.projectId;
  const reject = async (reason: string): Promise<InvokeResult> => { await observe(ctx, "rejected", toolId, raw, reason, true, null, 0); return { status: "rejected", reason }; };
  const def = getTool(toolId);
  if (!def) return reject("Herramienta no registrada.");
  if (!opts.allowed.includes(toolId)) return reject("Herramienta fuera de la lista autorizada para esta subtarea.");
  if (def.roles !== "all" && !def.roles.includes(ctx.agent)) return reject(`El rol ${ctx.agent} no tiene permiso para ${toolId}.`);
  const [pol] = await repo.sql.all<{ enabled: number; max_calls: number | null; budget_usd: number | null }>("SELECT enabled, max_calls, budget_usd FROM tool_policies WHERE project_id=? AND tool=?", [p, toolId]);
  if (pol && !pol.enabled) return reject("Herramienta desactivada para este proyecto.");
  const parsed = def.input.safeParse(raw);
  if (!parsed.success) return reject(`Entrada inválida: ${parsed.error.issues[0]?.message ?? "formato"}`);
  const input = parsed.data;
  const [{ n: used }] = await repo.sql.all<{ n: number }>("SELECT COUNT(*) n FROM auto_observations WHERE project_id=? AND run_id=? AND tool=? AND kind='tool'", [p, ctx.runId, toolId]) as [{ n: number }];
  const cap = Math.min(def.maxCalls, pol?.max_calls ?? Infinity, opts.limits.perToolCalls[toolId] ?? Infinity);
  if (used >= cap) return reject("Límite de llamadas de la herramienta alcanzado.");
  const [{ n: agentUsed }] = await repo.sql.all<{ n: number }>("SELECT COUNT(*) n FROM auto_observations WHERE project_id=? AND run_id=? AND agent=? AND kind='tool'", [p, ctx.runId, ctx.agent]) as [{ n: number }];
  if (agentUsed >= opts.limits.perAgentCalls) return reject("Límite de llamadas del agente alcanzado.");
  // Budget: estimate for provider tools; unknown price follows the run policy, never an invented number.
  let costUsd: number | null = 0;
  if (def.cost === "provider" && def.capability) {
    const m = await modelFor(ctx, def.capability);
    if (m.ok) { const est = estimateCost(await repo.getModelPrice(m.model.remote_id), { inputChars: JSON.stringify(input).length, outputChars: 4000 }); costUsd = est.pricing === "unpriced" ? null : est.amountUsd; }
    else costUsd = null;
  } else if (def.cost === "unknown") costUsd = null;
  const [run] = await repo.sql.all<{ spent_usd: number; calls: number }>("SELECT spent_usd, calls FROM auto_runs WHERE project_id=? AND id=?", [p, ctx.runId]);
  if (!run) return reject("Ejecución ajena al proyecto.");
  if (opts.limits.maxUsd !== null && costUsd !== null && run.spent_usd + costUsd > opts.limits.maxUsd) return reject("Presupuesto de la ejecución agotado.");
  if (pol?.budget_usd != null && costUsd !== null) {
    const [{ s }] = await repo.sql.all<{ s: number | null }>("SELECT SUM(cost_usd) s FROM auto_observations WHERE project_id=? AND tool=?", [p, toolId]) as [{ s: number | null }];
    if ((s ?? 0) + costUsd > pol.budget_usd) return reject("Presupuesto de la herramienta agotado.");
  }
  if (costUsd === null && def.cost !== "none" && opts.limits.unknownCost === "deny") return reject("Coste desconocido y la política lo prohíbe.");
  const avail = await def.availability(ctx).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));
  if (!avail.ok) return reject(`No disponible: ${avail.reason}`);
  // Approval bound to the exact action.
  const needsApproval = def.approval === "always" || (def.approval === "if-cost" && (costUsd === null ? opts.limits.unknownCost === "ask" : costUsd > 0));
  const target = def.target ? def.target(input, ctx) : "";
  // Idempotency: a completed op returns its stored result; an interrupted side effect goes to review.
  const [cp] = await repo.sql.all<{ id: string; state: string; detail: string }>("SELECT id, state, detail FROM auto_checkpoints WHERE project_id=? AND op_key=?", [p, opts.opKey]);
  if (cp?.state === "done") return { status: "ok", output: cp.detail, trusted: true };
  if (cp && ["intent", "uncertain"].includes(cp.state)) {
    if (def.sideEffect || def.cost !== "none") { await repo.sql.run("UPDATE auto_checkpoints SET state='uncertain', updated_at=? WHERE id=?", [Date.now(), cp.id]); return { status: "review", reason: "Una ejecución anterior de esta acción no confirmó su resultado. Revisa antes de repetir." }; }
  }
  if (needsApproval) {
    const fp = await fingerprintAction({ runId: ctx.runId, taskId: ctx.taskId, tool: toolId, params: input, target, costUsd });
    if (await approvals.rejected(repo, p, fp)) return reject("La persona rechazó esta acción.");
    if (!await approvals.consume(repo, p, fp)) {
      const a = await approvals.request(repo, p, { runId: ctx.runId, taskId: ctx.taskId, tool: toolId, params: input, target, costUsd, risk: def.risk, summary: `${def.name}: ${target || canonical(input).slice(0, 200)}` });
      return { status: "approval", approvalId: a.id, summary: a.summary };
    }
  }
  if (cp) await repo.sql.run("UPDATE auto_checkpoints SET state='intent', updated_at=? WHERE id=?", [Date.now(), cp.id]);
  else await repo.sql.run("INSERT INTO auto_checkpoints VALUES (?,?,?,?,?,?, 'intent', '', ?, ?)", [crypto.randomUUID(), p, ctx.runId, ctx.taskId, opts.opKey, toolId, Date.now(), Date.now()]);
  const t0 = Date.now();
  let out: ToolOut;
  try {
    if (!def.run) throw new ToolRejected("Sin implementación ejecutable.");
    out = await Promise.race([def.run({ ...ctx, opKey: opts.opKey }, input), new Promise<never>((_r, rej) => setTimeout(() => rej(new ToolRejected("Tiempo máximo superado.")), def.timeoutMs))]);
  } catch (e) {
    const msg = String(scrubSecrets({ detail: e instanceof Error ? e.message : String(e) })["detail"]).slice(0, 500);
    // Definite local rejections are safe to clear; anything else with side effects stays uncertain.
    if (e instanceof ToolRejected || (!def.sideEffect && def.cost === "none")) { await repo.sql.run("DELETE FROM auto_checkpoints WHERE project_id=? AND op_key=?", [p, opts.opKey]); return reject(msg); }
    await repo.sql.run("UPDATE auto_checkpoints SET state='uncertain', detail=?, updated_at=? WHERE project_id=? AND op_key=?", [msg, Date.now(), p, opts.opKey]);
    await observe(ctx, "uncertain", toolId, input, msg, true, costUsd, Date.now() - t0);
    return { status: "review", reason: msg };
  }
  const output = String(scrubSecrets({ detail: out.output })["detail"]);
  await repo.sql.run("UPDATE auto_checkpoints SET state='done', detail=?, updated_at=? WHERE project_id=? AND op_key=?", [output.slice(0, 20_000), Date.now(), p, opts.opKey]);
  await observe(ctx, "tool", toolId, input, output, out.trusted, out.costUsd ?? costUsd, Date.now() - t0);
  await repo.sql.run("UPDATE auto_runs SET spent_usd=spent_usd+?, unknown_cost_calls=unknown_cost_calls+?, updated_at=? WHERE project_id=? AND id=?", [costUsd ?? 0, costUsd === null && def.cost !== "none" ? 1 : 0, Date.now(), p, ctx.runId]);
  if (out.evidence) await repo.sql.run("INSERT INTO auto_evidence VALUES (?,?,?,?,?,?,?,?,?,?,?)", [crypto.randomUUID(), p, ctx.runId, ctx.taskId, out.evidence.kind, out.evidence.status, out.evidence.command.slice(0, 500), out.evidence.output.slice(0, 8000), await sha256Hex(out.evidence.output), ctx.nodeId ?? "android", Date.now()]);
  await workingMemory.add(repo, p, ctx.runId, out.trusted ? "observation" : "external", `${toolId}: ${output.slice(0, 1500)}`);
  return { status: "ok", output, trusted: out.trusted };
}
async function observe(ctx: ToolCtx, kind: string, tool: string, input: unknown, output: string, trusted: boolean, cost: number | null, ms: number) {
  await ctx.core.repo.sql.run("INSERT INTO auto_observations VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)", [crypto.randomUUID(), ctx.projectId, ctx.runId, ctx.taskId, ctx.agent, kind, tool,
    String(scrubSecrets({ detail: canonical(input) })["detail"]).slice(0, 2000), output.slice(0, 4000), trusted ? 1 : 0, cost, ms, Date.now()]);
}
/** JSON-schema-ish description for native tool calling. */
export function toolSchemaFor(def: ToolDef) {
  return { type: "function", function: { name: def.id.replace(/\./g, "__"), description: `${def.description} Riesgo ${def.risk}.`, parameters: { type: "object", additionalProperties: true } } };
}
