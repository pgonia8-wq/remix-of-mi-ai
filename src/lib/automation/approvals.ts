// Approvals bound to the exact action: fingerprint = SHA-256 of (run, task, tool, canonical params, target, cost).
// Any change produces a different fingerprint, so an earlier approval simply does not apply.
import type { Repo } from "../db/repo";

export type Approval = { id: string; project_id: string; run_id: string; task_id: string | null; tool: string; fingerprint: string; summary: string; target: string; cost_usd: number | null; risk: string; params: string; status: "pending" | "approved" | "rejected" | "consumed" | "revoked" | "superseded"; uses_left: number; created_at: number; decided_at: number | null };
const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
export async function sha256Hex(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join(""); }
export async function fingerprintAction(a: { runId: string; taskId: string | null; tool: string; params: unknown; target: string; costUsd: number | null }) {
  return sha256Hex(canonical({ r: a.runId, t: a.taskId, tool: a.tool, p: a.params, target: a.target, c: a.costUsd }));
}
export const approvals = {
  pending(repo: Repo, p: string) { need(p); return repo.sql.all<Approval>("SELECT * FROM auto_approvals WHERE project_id=? AND status='pending' ORDER BY created_at", [p]); },
  forRun(repo: Repo, p: string, runId: string) { need(p); return repo.sql.all<Approval>("SELECT * FROM auto_approvals WHERE project_id=? AND run_id=? ORDER BY created_at DESC", [p, runId]); },
  async request(repo: Repo, p: string, a: { runId: string; taskId: string | null; tool: string; params: unknown; target: string; costUsd: number | null; risk: string; summary: string }) {
    need(p); const fp = await fingerprintAction(a);
    const [existing] = await repo.sql.all<Approval>("SELECT * FROM auto_approvals WHERE project_id=? AND fingerprint=? AND status IN ('pending','approved') ORDER BY created_at DESC LIMIT 1", [p, fp]);
    if (existing) return existing;
    // A new, different request for the same task supersedes stale pending ones.
    if (a.taskId) await repo.sql.run("UPDATE auto_approvals SET status='superseded', decided_at=? WHERE project_id=? AND run_id=? AND task_id=? AND status='pending'", [Date.now(), p, a.runId, a.taskId]);
    const id = crypto.randomUUID();
    await repo.sql.run("INSERT INTO auto_approvals VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',1,?,NULL)", [id, p, a.runId, a.taskId, a.tool, fp, a.summary.slice(0, 500), a.target.slice(0, 300), a.costUsd, a.risk, canonical(a.params).slice(0, 4000), Date.now()]);
    return (await repo.sql.all<Approval>("SELECT * FROM auto_approvals WHERE id=?", [id]))[0]!;
  },
  async decide(repo: Repo, p: string, id: string, ok: boolean, uses = 1) {
    need(p); const n = Math.min(Math.max(1, Math.floor(uses)), 20);
    const r = await repo.sql.run("UPDATE auto_approvals SET status=?, uses_left=?, decided_at=? WHERE project_id=? AND id=? AND status='pending'", [ok ? "approved" : "rejected", n, Date.now(), p, id]);
    void r; const [a] = await repo.sql.all<Approval>("SELECT * FROM auto_approvals WHERE project_id=? AND id=?", [p, id]);
    if (!a) throw new Error("Aprobación ajena al proyecto");
    return a;
  },
  async revoke(repo: Repo, p: string, id: string) { need(p); await repo.sql.run("UPDATE auto_approvals SET status='revoked', decided_at=? WHERE project_id=? AND id=? AND status IN ('pending','approved')", [Date.now(), p, id]); },
  /** Consumes one use of an approval matching this exact fingerprint; returns false if none. */
  async consume(repo: Repo, p: string, fp: string) {
    need(p);
    const [a] = await repo.sql.all<Approval>("SELECT * FROM auto_approvals WHERE project_id=? AND fingerprint=? AND status='approved' AND uses_left>0 LIMIT 1", [p, fp]);
    if (!a) return false;
    await repo.sql.run("UPDATE auto_approvals SET uses_left=uses_left-1, status=CASE WHEN uses_left-1<=0 THEN 'consumed' ELSE status END WHERE id=? AND uses_left>0", [a.id]);
    return true;
  },
  async rejected(repo: Repo, p: string, fp: string) { need(p); return (await repo.sql.all("SELECT id FROM auto_approvals WHERE project_id=? AND fingerprint=? AND status='rejected'", [p, fp])).length > 0; },
};
