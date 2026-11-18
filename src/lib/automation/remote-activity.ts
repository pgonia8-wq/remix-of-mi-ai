import type { Repo } from "../db/repo";

/** Tools whose work happens on a VM, server or PC (shown in the terminal view). */
export const REMOTE_TOOLS = ["ssh.exec", "pc.exec", "shell.exec"] as const;
export type RemoteEntry = {
  id: string; runId: string; taskId: string | null; agent: string | null; tool: string;
  target: string; command: string; state: "waiting" | "running" | "ok" | "failed" | "uncertain" | "rejected";
  exitCode: number | null; output: string; ms: number; at: number;
};
const q = REMOTE_TOOLS.map(() => "?").join(",");
const parse = (s: string): Record<string, unknown> => { try { const j = JSON.parse(s); return j && typeof j === "object" ? j as Record<string, unknown> : {}; } catch { return {}; } };
const cmdOf = (i: Record<string, unknown>) => typeof i["command"] === "string" ? i["command"] as string : Array.isArray(i["argv"]) ? (i["argv"] as unknown[]).map(String).join(" ") : Array.isArray(i["args"]) ? (i["args"] as unknown[]).map(String).join(" ") : JSON.stringify(i).slice(0, 300);

/** What agents did (or are about to do) on remote machines, oldest first. Project-scoped; never reads credentials. */
export async function remoteActivity(repo: Repo, projectId: string, runId?: string, limit = 200): Promise<RemoteEntry[]> {
  if (!projectId) throw new Error("projectId requerido");
  const runF = runId ? " AND run_id=?" : "", args = [projectId, ...REMOTE_TOOLS, ...(runId ? [runId] : [])];
  const names = new Map((await repo.sql.all<{ id: string; name: string; config: string }>("SELECT id, name, config FROM connections WHERE project_id=?", [projectId]))
    .map((c) => { let host = ""; try { host = (JSON.parse(c.config) as { host?: string; user?: string }).host ?? ""; } catch { /* */ } return [c.id, host ? `${c.name} (${host})` : c.name] as const; }));
  const target = (tool: string, i: Record<string, unknown>) => tool === "ssh.exec" ? names.get(String(i["connectionId"] ?? "")) ?? "servidor" : "PC/VM con PC Node";
  const obs = await repo.sql.all<{ id: string; run_id: string; task_id: string | null; agent: string | null; kind: string; tool: string; input: string; output: string; ms: number; created_at: number }>(
    `SELECT id, run_id, task_id, agent, kind, tool, input, output, ms, created_at FROM auto_observations WHERE project_id=? AND tool IN (${q}) AND kind IN ('tool','uncertain','rejected')${runF} ORDER BY created_at DESC, rowid DESC LIMIT ?`, [...args, limit]);
  const out: RemoteEntry[] = obs.map((o) => {
    const i = parse(o.input), m = /^código=(-?\d+)\n?/.exec(o.output), exit = m ? Number(m[1]) : null;
    const state: RemoteEntry["state"] = o.kind === "rejected" ? "rejected" : o.kind === "uncertain" ? "uncertain" : exit !== null && exit !== 0 ? "failed" : "ok";
    return { id: o.id, runId: o.run_id, taskId: o.task_id, agent: o.agent, tool: o.tool, target: target(o.tool, i), command: cmdOf(i), state, exitCode: exit, output: m ? o.output.slice(m[0].length) : o.output, ms: o.ms, at: o.created_at };
  });
  const pend = await repo.sql.all<{ id: string; run_id: string; task_id: string | null; tool: string; params: string; created_at: number }>(
    `SELECT id, run_id, task_id, tool, params, created_at FROM auto_approvals WHERE project_id=? AND tool IN (${q}) AND status='pending'${runF}`, args);
  for (const a of pend) { const i = parse(a.params); out.push({ id: a.id, runId: a.run_id, taskId: a.task_id, agent: null, tool: a.tool, target: target(a.tool, i), command: cmdOf(i), state: "waiting", exitCode: null, output: "", ms: 0, at: a.created_at }); }
  const running = await repo.sql.all<{ id: string; run_id: string; task_id: string | null; tool: string; updated_at: number }>(
    `SELECT id, run_id, task_id, tool, updated_at FROM auto_checkpoints WHERE project_id=? AND tool IN (${q}) AND state='intent'${runF}`, args);
  for (const c of running) out.push({ id: c.id, runId: c.run_id, taskId: c.task_id, agent: null, tool: c.tool, target: c.tool === "ssh.exec" ? "servidor" : "PC/VM", command: "", state: "running", exitCode: null, output: "", ms: 0, at: c.updated_at });
  return out.sort((a, b) => a.at - b.at);
}
