// AI Builder: software factory on top of the orchestrator. REQUIREMENTS → ANALYSIS → ARCHITECTURE → PLAN →
// CODE → INSTALL → RUN → TEST → DEBUG → AUDIT → DELIVERY. Real builds/tests run on an authorized PC Node;
// QuickJS remains for light JS only. Delivery records hashes, versions and the audit report.
import type { Core } from "../core";
import { createRun, autoRuns, type PlanTask } from "./orchestrator";
import { pcFiles, folders } from "../nodes/storage";
import { sha256Hex } from "./approvals";

export type DeliverableKind = "web" | "android" | "api" | "backend" | "desktop" | "script" | "automation" | "database" | "multi-module" | "multi-service";
const READ = ["fs.list", "fs.read", "fs.search", "node.info"];
const WRITE = [...READ, "fs.write", "fs.versions"];
const BUILD = [...WRITE, "shell.exec", "git", "dev.node", "dev.npm", "dev.npx", "dev.python", "dev.pip", "dev.gradle", "dev.java", "dev.kotlin", "dev.cargo", "dev.rust", "dev.go", "dev.dotnet", "dev.gcc", "dev.clang", "dev.cmake", "dev.sqlite", "dev.foundry"];
export function builderPlan(kind: DeliverableKind, maxFixAttempts = 3): { tasks: PlanTask[]; acceptance: string[] } {
  const tasks: PlanTask[] = [
    { id: "req", title: "Requisitos y criterios verificables", role: "analyst", deps: [], files: ["docs/REQUISITOS.md"], tools: [...WRITE, "research.web", "memory.search"], contract: "docs/REQUISITOS.md con requisitos numerados y criterios de aceptación comprobables." },
    { id: "arch", title: "Arquitectura y plan de archivos", role: "architect", deps: ["req"], files: ["docs/ARQUITECTURA.md"], tools: WRITE, contract: `docs/ARQUITECTURA.md: módulos, contratos, stack para un entregable «${kind}», estructura de archivos y comandos de instalación/compilación/prueba.` },
    { id: "code", title: "Implementación", role: kind === "web" ? "frontend" : kind === "database" ? "database" : "backend", deps: ["arch"], files: [], tools: BUILD, contract: "Código fuente completo según la arquitectura, con dependencias declaradas e instaladas." },
    { id: "tests", title: "Pruebas automatizadas", role: "tester", deps: ["code"], files: [], tools: [...BUILD, "quality.run"], contract: "Pruebas automatizadas que cubran los criterios; ejecutadas con quality.run y aprobadas (evidencia real)." },
    { id: "sec", title: "Revisión de seguridad y dependencias", role: "security", deps: ["code"], files: ["docs/SEGURIDAD.md"], tools: [...READ, "fs.write", "quality.run"], contract: "Auditoría de dependencias ejecutada y hallazgos documentados en docs/SEGURIDAD.md." },
    { id: "docs", title: "Documentación de uso", role: "documenter", deps: ["tests"], files: ["README.md"], tools: WRITE, contract: "README.md con instalación, uso, pruebas y limitaciones reales." },
  ];
  return { tasks: tasks.map((t) => ({ ...t, files: t.files })), acceptance: ["Compila o se ejecuta en el entorno elegido", "Pruebas automatizadas ejecutadas y aprobadas", "Documentación presente", `Máximo ${maxFixAttempts} ciclos de corrección`] };
}
const P_READ = ["fs.list", "fs.read", "fs.search"];
const P_WRITE = [...P_READ, "fs.write", "fs.versions"];
const P_BUILD = [...P_WRITE, "code.run", "code.js"];
/** Phone plan: same pipeline, phone workspace; tests are self-contained JS run in QuickJS; native builds are declared, not faked. */
export function builderPlanPhone(kind: DeliverableKind, maxFixAttempts = 3): { tasks: PlanTask[]; acceptance: string[] } {
  const tasks: PlanTask[] = [
    { id: "req", title: "Requisitos y criterios verificables", role: "analyst", deps: [], files: ["docs/REQUISITOS.md"], tools: [...P_WRITE, "research.web", "memory.search"], contract: "docs/REQUISITOS.md con requisitos numerados y criterios de aceptación comprobables." },
    { id: "arch", title: "Arquitectura y plan de archivos", role: "architect", deps: ["req"], files: ["docs/ARQUITECTURA.md"], tools: P_WRITE, contract: `docs/ARQUITECTURA.md: módulos, contratos y stack para un entregable «${kind}», estructura de archivos y comandos de instalación/compilación. Separa la lógica en JavaScript autocontenido comprobable en el teléfono.` },
    { id: "code", title: "Implementación", role: kind === "web" ? "frontend" : kind === "database" ? "database" : "backend", deps: ["arch"], files: [], tools: P_BUILD, contract: "Código fuente completo según la arquitectura en el espacio del teléfono. Si el entregable necesita compilación nativa (Android, escritorio, binarios), déjalo listo para compilar y documenta los comandos; no afirmes haberlo compilado." },
    { id: "tests", title: "Pruebas automatizadas", role: "tester", deps: ["code"], files: [], tools: [...P_BUILD, "quality.run"], contract: "Pruebas autocontenidas en tests/*.test.js (sin import/require; lanzan error si fallan) ejecutadas con quality.run en el teléfono y aprobadas (evidencia real)." },
    { id: "sec", title: "Revisión de seguridad", role: "security", deps: ["code"], files: ["docs/SEGURIDAD.md"], tools: [...P_READ, "fs.write"], contract: "Revisión estática de riesgos documentada en docs/SEGURIDAD.md; indica que la auditoría de dependencias requiere un PC Node." },
    { id: "docs", title: "Documentación de uso", role: "documenter", deps: ["tests"], files: ["README.md"], tools: P_WRITE, contract: "README.md con instalación, uso, pruebas y limitaciones reales (qué se probó en el teléfono y qué requiere compilar en PC/VM)." },
  ];
  return { tasks, acceptance: ["Código y documentación presentes en el espacio del proyecto", "Pruebas automatizadas ejecutadas y aprobadas", `Máximo ${maxFixAttempts} ciclos de corrección`] };
}
export async function createBuilderRun(core: Core, p: string, o: { requirements: string; kind: DeliverableKind; nodeId: string | null; folderId: string | null; modelId?: string | null; sshId?: string | null; maxFixAttempts?: number; limits?: Parameters<typeof createRun>[2]["limits"] }) {
  if (o.folderId) {
    const f = await folders.get(core.repo, p, o.folderId);
    if (!f || f.node_id !== o.nodeId) throw new Error("La carpeta elegida no pertenece a este proyecto o a ese PC Node.");
  }
  const plan = o.folderId ? builderPlan(o.kind, o.maxFixAttempts ?? 3) : builderPlanPhone(o.kind, o.maxFixAttempts ?? 3);
  const id = await createRun(core, p, { goal: `Construir (${o.kind}): ${o.requirements}`, acceptance: plan.acceptance, kind: "builder", nodeId: o.folderId ? o.nodeId : null, folderId: o.folderId, modelId: o.modelId ?? null, sshId: o.sshId ?? null, plan, limits: { ...o.limits } });
  await core.repo.sql.run("UPDATE auto_tasks SET max_attempts=? WHERE project_id=? AND run_id=?", [Math.min(Math.max(o.maxFixAttempts ?? 3, 1), 6), p, id]);
  return id;
}
/** Delivery: every file hashed (read back from the PC with integrity check), versioned per run, plus report. */
export async function packageDeliverable(core: Core, p: string, runId: string) {
  const run = await autoRuns.get(core, p, runId);
  if (!run) throw new Error("Ejecución ajena al proyecto");
  if (run.status !== "completed") throw new Error("Solo se entregan ejecuciones aprobadas por el auditor.");
  const env = JSON.parse(run.env) as { nodeId: string | null; folderId: string | null };
  if (!env.folderId) return packagePhone(core, p, runId, run.result);
  const listing = await pcFiles.list(core.repo, p, env.folderId);
  if (!listing.online) throw new Error("La PC está desconectada; la entrega se podrá generar al reconectar.");
  const [{ v }] = await core.repo.sql.all<{ v: number | null }>("SELECT MAX(version) v FROM auto_artifacts WHERE project_id=? AND run_id=?", [p, runId]) as [{ v: number | null }];
  const version = (v ?? 0) + 1;
  const manifest: { path: string; sha256: string; size: number }[] = [];
  for (const file of listing.files.filter((x) => !x.dir).slice(0, 2000)) {
    const r = await pcFiles.read(core.repo, p, env.folderId, file.path);
    manifest.push({ path: file.path, sha256: r.hash, size: r.bytes.length });
    await core.repo.sql.run("INSERT INTO auto_artifacts VALUES (?,?,?,?,?,?,?,?,?)", [crypto.randomUUID(), p, runId, file.path, "pc", file.path, r.hash, version, Date.now()]);
  }
  const evidence = await autoRuns.evidence(core, p, runId);
  const report = `${run.result}\n\nVersión de entrega: ${version}\nArchivos: ${manifest.length}\nHash del manifiesto: ${await sha256Hex(JSON.stringify(manifest))}\n\nPruebas:\n${evidence.map((e) => `- ${e.status} · ${e.check_kind} · ${e.command}`).join("\n")}`;
  const asset = await core.assets.put(p, (async function* () { yield new TextEncoder().encode(JSON.stringify({ report, manifest }, null, 2)); })(), { kind: "text", mime: "application/json", name: `entrega-v${version}.json`, capability: "builder" });
  return { version, files: manifest.length, assetId: asset.id, report };
}

/** Phone delivery: ZIP of the phone workspace (integrity-checked reads) plus manifest and audit report. */
async function packagePhone(core: Core, p: string, runId: string, result: string) {
  const { localWs } = await import("./local-workspace");
  const { zipStore } = await import("../zip");
  const [{ v }] = await core.repo.sql.all<{ v: number | null }>("SELECT MAX(version) v FROM auto_artifacts WHERE project_id=? AND run_id=?", [p, runId]) as [{ v: number | null }];
  const version = (v ?? 0) + 1;
  const manifest: { path: string; sha256: string; size: number }[] = [], entries: { path: string; data: Uint8Array }[] = [];
  for (const f of await localWs.list(core.repo, p)) {
    const r = await localWs.read(core.repo, p, f.path);
    const data = new TextEncoder().encode(r.text);
    manifest.push({ path: f.path, sha256: r.hash, size: data.length }); entries.push({ path: f.path, data });
    await core.repo.sql.run("INSERT INTO auto_artifacts VALUES (?,?,?,?,?,?,?,?,?)", [crypto.randomUUID(), p, runId, f.path, "phone", f.path, r.hash, version, Date.now()]);
  }
  if (!entries.length) throw new Error("El espacio del teléfono está vacío; no hay nada que entregar.");
  const evidence = await autoRuns.evidence(core, p, runId);
  const report = `${result}\n\nVersión de entrega: ${version}\nEntorno: teléfono\nArchivos: ${manifest.length}\nHash del manifiesto: ${await sha256Hex(JSON.stringify(manifest))}\n\nPruebas:\n${evidence.map((e) => `- ${e.status} · ${e.check_kind} · ${e.command}`).join("\n")}`;
  entries.push({ path: "ENTREGA.txt", data: new TextEncoder().encode(report) });
  const zip = zipStore(entries);
  const asset = await core.assets.put(p, (async function* () { yield zip; })(), { kind: "document", mime: "application/zip", name: `entrega-v${version}.zip`, capability: "builder" });
  return { version, files: manifest.length, assetId: asset.id, report };
}
