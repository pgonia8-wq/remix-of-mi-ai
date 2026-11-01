// Resource Orchestrator: deterministic choice of where a task runs. Never sends private data to an
// external environment without an explicit authorization flag.
import type { NodeInfo } from "./client";

export type EnvKind = "android" | "sandbox" | "pc" | "vm" | "external";
export type Environment = { id: string; kind: EnvKind; online: boolean; info?: Partial<NodeInfo> & { toolchains?: Record<string, string> }; latencyMs?: number; costPerHour?: number | null; authorizedForPrivate: boolean };
export type TaskNeeds = { kind: "chat" | "memory" | "js" | "build" | "android-build" | "data" | "storage"; toolchains?: string[]; minMemBytes?: number; privateData?: boolean; manualEnvId?: string | null };
export type Placement = { ok: true; env: Environment; reasons: string[] } | { ok: false; reason: string };

const LOCAL: Record<TaskNeeds["kind"], EnvKind[]> = { chat: ["android"], memory: ["android"], js: ["sandbox"], build: [], "android-build": [], data: [], storage: ["android"] };
export function place(envs: Environment[], need: TaskNeeds): Placement {
  if (need.manualEnvId) {
    const e = envs.find((x) => x.id === need.manualEnvId);
    if (!e?.online) return { ok: false, reason: "El entorno elegido no está disponible." };
    const why = unmet(e, need); return why ? { ok: false, reason: why } : { ok: true, env: e, reasons: ["Selección manual"] };
  }
  const fixed = LOCAL[need.kind];
  if (fixed.length) { const e = envs.find((x) => fixed.includes(x.kind)); if (e) return { ok: true, env: e, reasons: ["Se mantiene en el teléfono por privacidad y latencia."] }; }
  const scored = envs.filter((e) => e.online && !["android", "sandbox"].includes(e.kind) && !unmet(e, need)).map((e) => {
    let s = 0; const r: string[] = [];
    s += Math.min((e.info?.cpus ?? 1) * 2, 32); r.push(`${e.info?.cpus ?? "?"} CPU`);
    s += Math.min((e.info?.memFree ?? 0) / 2 ** 30, 32); r.push(`${Math.round((e.info?.memFree ?? 0) / 2 ** 30)} GB libres`);
    if (e.kind === "pc") { s += 10; r.push("PC propia en red local"); }
    if (e.costPerHour) { s -= e.costPerHour * 10; r.push(`coste ${e.costPerHour}/h`); }
    if (e.latencyMs) s -= e.latencyMs / 50;
    return { e, s, r };
  }).sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (!best) return { ok: false, reason: need.kind === "android-build" ? "Ningún nodo conectado tiene Gradle y Android SDK." : "Ningún entorno conectado cumple los requisitos (toolchains, memoria o autorización)." };
  return { ok: true, env: best.e, reasons: best.r };
}
function unmet(e: Environment, need: TaskNeeds): string | null {
  if (need.privateData && e.kind === "external" && !e.authorizedForPrivate) return "Datos privados: falta autorización para este entorno externo.";
  const req = [...(need.toolchains ?? []), ...(need.kind === "android-build" ? ["gradle", "java"] : [])];
  for (const t of req) if (!e.info?.toolchains?.[t] && !["android", "sandbox"].includes(e.kind)) return `Falta ${t} en ${e.id}.`;
  if (need.minMemBytes && (e.info?.memFree ?? Infinity) < need.minMemBytes) return "Memoria insuficiente.";
  return null;
}
/** Failover: if the chosen node vanished, choose again but never re-run steps whose result is uncertain. */
export function failover(envs: Environment[], need: TaskNeeds, lostEnvId: string) { return place(envs.map((e) => e.id === lostEnvId ? { ...e, online: false } : e), { ...need, manualEnvId: null }); }
