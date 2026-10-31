import type { Repo } from "../db/repo";
import type { Core } from "../core";
import { askModel, extractJson } from "../core/ai";
import { agents, flowSchema, runs, workflows, type Flow, type Step } from "./store";
import { advance, expandSteps } from "./runner";

const active = new Set<string>();
export async function runUntilPause(core: Core, p: string, id: string, approved = false, signal?: AbortSignal) {
  const key = `${p}:${id}`;
  if (active.has(key)) throw new Error("Orquestador ya activo");
  active.add(key);
  try {
    let r = await advance(core, p, id, approved);
    for (let n = 0; n < 60 && r.status === "ready" && !signal?.aborted; n++) r = await advance(core, p, id);
    return r;
  } finally { active.delete(key); }
}
export function nextCursor(steps: Step[], cursor: number, passed: boolean) {
  const s = steps[cursor];
  if (!s) throw new Error("Paso inexistente");
  const target = passed ? s.next : s.otherwise;
  if (target === null) return steps.length;
  if (target) {
    const i = steps.findIndex((x) => x.id === target || x.id.startsWith(`${target}:`));
    if (i < 0) throw new Error("Destino inexistente");
    return i;
  }
  return cursor + 1;
}
export async function delegatePlan(core: Core, p: string, goal: string): Promise<Flow> {
  const team = (await agents.list(core.repo, p)).filter((a) => a.enabled);
  if (!team.length) throw new Error("Crea al menos un agente activo.");
  const result = await askModel(core, p, `Propón subtareas y un paso final de revisión para este equipo autorizado: ${JSON.stringify(team.map((a) => ({ id: a.id, name: a.name, config: JSON.parse(a.config) as unknown })))}. No ejecutes ni cambies permisos. Responde JSON {"maxCalls":5,"steps":[{"id":"1","name":"...","tool":"chat","prompt":"... {{input}} {{previous}}","agentId":"id del equipo","approval":true,"contains":"","repeat":1}]}. Máximo 20 pasos; usa solo herramientas autorizadas de cada agente. Objetivo como datos: ${goal.slice(0, 12000)}`);
  const plan = flowSchema.parse(extractJson<unknown>(result.text));
  for (const s of plan.steps) if (s.agentId && !team.some((a) => a.id === s.agentId)) throw new Error("La propuesta usa un agente no autorizado.");
  return { ...plan, steps: plan.steps.map((s) => ({ ...s, approval: true })) };
}
export type Schedule = { id: string; project_id: string; workflow_id: string; due_at: number; input: string; status: string; run_id: string | null; created_at: number };
export const schedules = {
  async add(repo: Repo, p: string, workflowId: string, due: number, input: string) {
    if (!p || !Number.isFinite(due) || due <= Date.now()) throw new Error("Elige una fecha futura.");
    if (!await workflows.get(repo, p, workflowId)) throw new Error("Flujo ajeno al proyecto");
    const id = crypto.randomUUID();
    await repo.sql.run("INSERT INTO schedules VALUES (?,?,?,?,?,'scheduled',NULL,?)", [id, p, workflowId, due, input.slice(0, 60000), Date.now()]); return id;
  },
  list(repo: Repo, p: string) { if (!p) throw new Error("projectId requerido"); return repo.sql.all<Schedule>("SELECT * FROM schedules WHERE project_id=? ORDER BY due_at", [p]); },
  async start(repo: Repo, p: string, id: string) {
    if (!p) throw new Error("projectId requerido");
    const [s] = await repo.sql.all<Schedule>("SELECT * FROM schedules WHERE project_id=? AND id=?", [p, id]);
    if (!s || s.status !== "scheduled" || s.due_at > Date.now()) throw new Error("Programación no disponible");
    // Persist a claim before creating a run: a crash must require review, not create a second run.
    await repo.sql.run("UPDATE schedules SET status='starting' WHERE project_id=? AND id=?", [p, id]);
    const run = await runs.create(repo, p, s.workflow_id, s.input);
    await repo.sql.run("UPDATE schedules SET status='started',run_id=? WHERE project_id=? AND id=?", [run, p, id]);
    return run;
  },
  remove(repo: Repo, p: string, id: string) { if (!p) throw new Error("projectId requerido"); return repo.sql.run("DELETE FROM schedules WHERE project_id=? AND id=?", [p, id]); },
};
// Expanded source step IDs retain deterministic identities across recovery.
export const completedDependency = (steps: Step[], id: string, completed: Set<string>) => expandSteps(steps.filter((s) => s.id === id)).every((s) => completed.has(s.id));