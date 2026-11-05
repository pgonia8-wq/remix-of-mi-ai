import type { RoleModels } from "@/lib/automation/role-models";
import { ROLES, type Role } from "@/lib/automation/orchestrator";
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Bot, Check, X, Pause, RefreshCw, Square, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { useCoreQuery, useCoreMutate } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { saveExport } from "@/lib/save-export";

const STATUS: Record<string, string> = { active: "Trabajando", paused: "En pausa", waiting: "Esperando tu aprobación", review_required: "Requiere tu revisión", needs_human: "Necesita tu intervención", completed: "Terminado", cancelled: "Detenido", failed: "Fallido" };
const TASK: Record<string, string> = { pending: "en espera", active: "trabajando", waiting_approval: "espera aprobación", review_required: "revisión", audit: "en auditoría", approved: "aprobada", failed: "fallida", replaced: "reemplazada", cancelled: "detenida" };

/** Live card for an autonomous run started from the chat: progress, approvals, controls and delivery. */
export function AutoRunInline({ pid, runId }: { pid: string; runId: string }) {
  const qc = useQueryClient();
  const mutate = useCoreMutate();
  const { data } = useCoreQuery(["auto-inline", pid, runId], async (c) => {
    const { autoRuns } = await import("@/lib/automation/orchestrator");
    const { approvals } = await import("@/lib/automation/approvals");
    const run = await autoRuns.get(c, pid, runId);
    if (!run) return null;
    const tasks = await autoRuns.tasks(c, pid, runId);
    const pending = (await approvals.pending(c.repo, pid)).filter((a) => a.run_id === runId);
    return { run, tasks, pending };
  });
  const run = data?.run;

  // Keep the run advancing on its own while this conversation is open (also after reopening the app).
  useEffect(() => {
    let off = () => {};
    void (async () => {
      const { driveRun, onRunProgress } = await import("@/lib/automation/drive");
      off = onRunProgress((id) => { if (id === runId) void qc.invalidateQueries({ queryKey: ["core", "auto-inline", pid, runId] }); });
      if (run?.status === "active") driveRun(await getCore(), pid, runId);
    })();
    return () => off();
  }, [pid, runId, run?.status, qc]);

  if (data === undefined) return <div className="my-3 flex items-center gap-2 rounded-2xl border border-border/70 bg-card p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando equipo de agentes…</div>;
  if (!run) return <p className="my-3 text-sm text-muted-foreground">La ejecución autónoma ya no existe.</p>;

  const assignments = (JSON.parse(run.env) as { roleModels?: RoleModels }).roleModels ?? {};
  const visible = data.tasks.filter((t) => t.status !== "replaced");
  const approved = visible.filter((t) => t.status === "approved").length;
  const resume = async () => { await mutate(async (c) => { const { autoRuns } = await import("@/lib/automation/orchestrator"); await autoRuns.resume(c, pid, runId); const { driveRun } = await import("@/lib/automation/drive"); driveRun(c, pid, runId); }); };
  const decide = (id: string, ok: boolean) => mutate(async (c) => {
    const { approvals } = await import("@/lib/automation/approvals");
    const { afterApproval } = await import("@/lib/automation/orchestrator");
    const { driveRun } = await import("@/lib/automation/drive");
    await approvals.decide(c.repo, pid, id, ok); await afterApproval(c, pid, id); driveRun(c, pid, runId);
  }).catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo registrar la decisión."));
  const deliver = async () => {
    try {
      const c = await getCore();
      const { packageDeliverable } = await import("@/lib/automation/builder");
      const d = await packageDeliverable(c, pid, runId);
      const asset = await c.assets.get(pid, d.assetId);
      if (!confirm("¿Exportar una copia sin cifrar de la entrega?")) return;
      await saveExport(await c.assets.read(pid, d.assetId), asset?.name ?? `entrega-v${d.version}`, asset?.mime ?? "application/zip");
    } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo preparar la entrega."); }
  };

  return <section aria-label="Equipo de agentes" className="glass-card my-3 space-y-3 rounded-2xl border border-border/70 p-4">
    <header className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">{run.status === "active" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Bot className="h-5 w-5" />}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{run.kind === "builder" ? "AI Builder" : "Equipo de agentes"} · {STATUS[run.status] ?? run.status}</p>
        <p className="break-words text-xs text-muted-foreground">{run.goal.slice(0, 220)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{visible.length ? `${approved}/${visible.length} subtareas aprobadas` : "Planificando…"} · {run.calls} llamadas · US$ {run.spent_usd.toFixed(4)}{run.unknown_cost_calls ? ` + ${run.unknown_cost_calls} sin precio conocido` : ""} · en el teléfono</p>
      </div>
    </header>
    <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Modelos del equipo</summary><ul className="mt-2 space-y-1">{Object.entries(assignments).map(([role, m]) => <li key={role} className="break-words">{ROLES[role as Role]?.name ?? role} · {m.name} · {m.provider} · {m.deployment}</li>)}</ul></details>
    {visible.length > 0 && <ul className="space-y-1 text-xs">{visible.map((t) => <li key={t.id} className="flex gap-2"><span className={t.status === "approved" ? "text-success" : t.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{t.status === "approved" ? "✓" : t.status === "failed" ? "✕" : "•"}</span><span className="min-w-0 flex-1 truncate">{t.title}</span><span className="shrink-0 text-muted-foreground">{TASK[t.status] ?? t.status}</span></li>)}</ul>}
    {data.pending.map((a) => <div key={a.id} className="space-y-2 rounded-xl border border-primary/40 p-3 text-sm">
      <p className="break-words">{a.summary}</p>
      {a.cost_usd != null && <p className="text-xs text-muted-foreground">Costo estimado: US$ {a.cost_usd.toFixed(4)}</p>}
      <div className="flex gap-2"><Button size="sm" onClick={() => decide(a.id, true)}><Check />Aprobar</Button><Button size="sm" variant="outline" onClick={() => decide(a.id, false)}><X />Rechazar</Button></div>
    </div>)}
    {run.error && run.status !== "completed" && <p className="break-words text-xs text-destructive">{run.error}</p>}
    {run.status === "completed" && run.result && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Informe del auditor</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{run.result}</pre></details>}
    <div className="flex flex-wrap gap-2">
      {["active", "waiting"].includes(run.status) && <Button size="sm" variant="outline" onClick={() => mutate(async (c) => { const { autoRuns } = await import("@/lib/automation/orchestrator"); await autoRuns.pause(c, pid, runId); })}><Pause />Pausar</Button>}
      {["paused", "needs_human"].includes(run.status) && <Button size="sm" variant="outline" onClick={resume}><RefreshCw />Reanudar</Button>}
      {!["completed", "cancelled"].includes(run.status) && <Button size="sm" variant="outline" onClick={() => { if (confirm("¿Detener esta ejecución?")) void mutate(async (c) => { const { autoRuns } = await import("@/lib/automation/orchestrator"); await autoRuns.cancel(c, pid, runId); }); }}><Square />Detener</Button>}
      {run.status === "completed" && <Button size="sm" variant="outline" onClick={deliver}><Download />Descargar entrega</Button>}
      <Button size="sm" variant="ghost" asChild><Link to="/autonomy">Ver detalle</Link></Button>
    </div>
  </section>;
}
