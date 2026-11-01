import { z } from "zod";
import type { Repo } from "../db/repo";

export const TOOLS = ["chat", "research.web", "image.generate", "audio.tts", "note.save", "task.add", "code.execute"] as const;
export const agentSchema = z.object({
  instructions: z.string().min(1).max(12_000), objective: z.string().max(2000), expected: z.string().max(2000),
  modelId: z.string().nullable(), tools: z.array(z.enum(TOOLS)).min(1).max(7), memory: z.boolean(), maxCalls: z.number().int().min(1).max(20),
});
export type AgentConfig = z.infer<typeof agentSchema>;
export type Agent = { id: string; project_id: string; name: string; config: string; enabled: number; updated_at: number };
export const stepSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(100), tool: z.enum(TOOLS), prompt: z.string().max(60_000),
  agentId: z.string().nullable().default(null), approval: z.boolean().default(true),
  contains: z.string().max(200).default(""), repeat: z.number().int().min(1).max(3).default(1),
  next: z.string().nullable().optional(), otherwise: z.string().nullable().optional(),
  dependsOn: z.array(z.string()).max(20).optional(),
});
export const flowSchema = z.object({ steps: z.array(stepSchema).min(1).max(20), maxCalls: z.number().int().min(1).max(20), autonomous: z.object({ agentId: z.string().min(1), maxTurns: z.number().int().min(1).max(8), goal: z.string().min(1).max(12000) }).optional() }).superRefine((v, ctx) => {
  if (new Set(v.steps.map((s) => s.id)).size !== v.steps.length) ctx.addIssue({ code: "custom", message: "Los pasos necesitan identificadores únicos." });
  v.steps.forEach((s, i) => {
    for (const target of [s.next, s.otherwise, ...(s.dependsOn ?? [])]) {
      if (target && !v.steps.some((x) => x.id === target)) ctx.addIssue({ code: "custom", message: "Referencia a paso inexistente." });
    }
    for (const dep of s.dependsOn ?? []) if (!v.steps.slice(0, i).some((x) => x.id === dep)) ctx.addIssue({ code: "custom", message: "Dependencias deben señalar pasos anteriores." });
  });
});
export type Flow = z.infer<typeof flowSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Workflow = { id: string; project_id: string; name: string; definition: string; enabled: number; updated_at: number };
export type Run = { id: string; project_id: string; workflow_id: string; definition: string; status: "ready" | "running" | "approval" | "completed" | "failed" | "cancelled" | "recovery_required"; cursor: number; calls: number; input: string; output: string; error: string | null; created_at: number; updated_at: number };
export type Event = { id: string; project_id: string; run_id: string; step_id: string; agent_id: string | null; kind: string; detail: string; created_at: number };
const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
async function project(repo: Repo, p: string) { need(p); if (!await repo.getProject(p)) throw new Error("Proyecto inexistente"); }
export const agents = {
  list(repo: Repo, p: string) { need(p); return repo.sql.all<Agent>("SELECT * FROM agents WHERE project_id=? ORDER BY updated_at DESC", [p]); },
  async get(repo: Repo, p: string, id: string) { need(p); return (await repo.sql.all<Agent>("SELECT * FROM agents WHERE project_id=? AND id=?", [p, id]))[0] ?? null; },
  async save(repo: Repo, p: string, name: string, config: AgentConfig, id?: string) {
    await project(repo, p); const data = agentSchema.parse(config); if (!name.trim()) throw new Error("Falta el nombre del agente.");
    if (id && !await agents.get(repo, p, id)) throw new Error("Agente ajeno al proyecto");
    const key = id ?? crypto.randomUUID();
    if (id) await repo.sql.run("UPDATE agents SET name=?, config=?, updated_at=? WHERE project_id=? AND id=?", [name.trim(), JSON.stringify(data), Date.now(), p, id]);
    else await repo.sql.run("INSERT INTO agents VALUES (?,?,?,?,1,?)", [key, p, name.trim(), JSON.stringify(data), Date.now()]);
    return key;
  },
  toggle(repo: Repo, p: string, id: string, enabled: boolean) { need(p); return repo.sql.run("UPDATE agents SET enabled=? WHERE project_id=? AND id=?", [enabled ? 1 : 0, p, id]); },
  remove(repo: Repo, p: string, id: string) { need(p); return repo.sql.run("DELETE FROM agents WHERE project_id=? AND id=?", [p, id]); },
};
export const workflows = {
  list(repo: Repo, p: string) { need(p); return repo.sql.all<Workflow>("SELECT * FROM workflows WHERE project_id=? ORDER BY updated_at DESC", [p]); },
  async get(repo: Repo, p: string, id: string) { need(p); return (await repo.sql.all<Workflow>("SELECT * FROM workflows WHERE project_id=? AND id=?", [p, id]))[0] ?? null; },
  async save(repo: Repo, p: string, name: string, flow: Flow, id?: string) {
    await project(repo, p); const data = flowSchema.parse(flow); if (!name.trim()) throw new Error("Falta el nombre del flujo.");
    for (const s of data.steps) if (s.agentId && !await agents.get(repo, p, s.agentId)) throw new Error("Agente ajeno al proyecto");
    if (data.autonomous && !await agents.get(repo, p, data.autonomous.agentId)) throw new Error("Agente ajeno al proyecto");
    if (id && !await workflows.get(repo, p, id)) throw new Error("Flujo ajeno al proyecto");
    const key = id ?? crypto.randomUUID();
    if (id) await repo.sql.run("UPDATE workflows SET name=?, definition=?, updated_at=? WHERE project_id=? AND id=?", [name.trim(), JSON.stringify(data), Date.now(), p, id]);
    else await repo.sql.run("INSERT INTO workflows VALUES (?,?,?,?,1,?)", [key, p, name.trim(), JSON.stringify(data), Date.now()]);
    return key;
  },
  toggle(repo: Repo, p: string, id: string, enabled: boolean) { need(p); return repo.sql.run("UPDATE workflows SET enabled=? WHERE project_id=? AND id=?", [enabled ? 1 : 0, p, id]); },
  remove(repo: Repo, p: string, id: string) { need(p); return repo.sql.run("DELETE FROM workflows WHERE project_id=? AND id=?", [p, id]); },
};
export const runs = {
  list(repo: Repo, p: string) { need(p); return repo.sql.all<Run>("SELECT * FROM workflow_runs WHERE project_id=? ORDER BY created_at DESC", [p]); },
  async get(repo: Repo, p: string, id: string) { need(p); return (await repo.sql.all<Run>("SELECT * FROM workflow_runs WHERE project_id=? AND id=?", [p, id]))[0] ?? null; },
  events(repo: Repo, p: string, id: string) { need(p); return repo.sql.all<Event>("SELECT * FROM execution_events WHERE project_id=? AND run_id=? ORDER BY created_at", [p, id]); },
  async event(repo: Repo, p: string, runId: string, s: Step, kind: string, detail: string) {
    need(p); await repo.sql.run("INSERT INTO execution_events VALUES (?,?,?,?,?,?,?,?)", [crypto.randomUUID(), p, runId, s.id, s.agentId, kind, detail.slice(0, 2000), Date.now()]);
  },
  async create(repo: Repo, p: string, id: string, input: string) {
    await project(repo, p); const w = await workflows.get(repo, p, id); if (!w?.enabled) throw new Error("Flujo desactivado o inexistente");
    flowSchema.parse(JSON.parse(w.definition)); const key = crypto.randomUUID(), now = Date.now();
    await repo.sql.run("INSERT INTO workflow_runs VALUES (?,?,?,?, 'ready',0,0,?,'',NULL,?,?)", [key, p, id, w.definition, input.slice(0, 60_000), now, now]);
    return key;
  },
  async cancel(repo: Repo, p: string, id: string) { need(p); await repo.sql.run("UPDATE workflow_runs SET status='cancelled', updated_at=? WHERE project_id=? AND id=? AND status NOT IN ('completed','running')", [Date.now(), p, id]); },
  async recover(repo: Repo) { await repo.sql.run("UPDATE workflow_runs SET status='recovery_required', error='Ejecución interrumpida. Revisa el historial antes de reintentar.', updated_at=? WHERE status='running'", [Date.now()]); },
};