import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "./ui/button";
import { inputCls } from "./AppShell";
import { useCoreQuery, useCoreMutate } from "../lib/use-app";
import { agents, runs, type Flow } from "../lib/automation/store";
import { createAdaptiveRun, advanceAdaptive } from "../lib/automation/react";
import { toast } from "sonner";

export function AdaptiveRuns({ projectId }: { projectId: string }) {
  const { data: team = [] } = useCoreQuery(["agents", projectId], (c) => agents.list(c.repo, projectId));
  const { data: history = [] } = useCoreQuery(["runs", projectId], (c) => runs.list(c.repo, projectId));
  const mutate = useCoreMutate();
  const [agent, setAgent] = useState(""), [goal, setGoal] = useState(""), [limit, setLimit] = useState(5), [busy, setBusy] = useState(false);
  async function action(fn: Parameters<typeof mutate>[0]) {
    setBusy(true); try { await mutate(fn); } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo continuar."); } finally { setBusy(false); }
  }
  return <section className="space-y-3">
    <label className="block text-sm">Agente<select className={inputCls} value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">Seleccionar</option>{team.filter((a) => a.enabled).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label className="block text-sm">Objetivo<textarea className={inputCls} rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
    <label className="block text-sm">Máximo de solicitudes<input className={inputCls} type="number" min={1} max={20} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
    <Button disabled={busy || !agent || !goal.trim()} onClick={() => action((c) => createAdaptiveRun(c, projectId, agent, goal, limit))}><Play />Crear ejecución</Button>
    {history.filter((r) => (JSON.parse(r.definition) as Flow).autonomous).map((r) => {
      const flow = JSON.parse(r.definition) as Flow, step = flow.steps[r.cursor];
      return <article key={r.id} className="space-y-2 border-t py-3">
        <h2 className="break-words font-semibold">{flow.autonomous?.goal}</h2>
        <p className="text-sm text-muted-foreground">{r.status} · {r.calls}/{flow.maxCalls} solicitudes</p>
        {step && <><p className="text-sm">{step.name} · {step.tool}</p>{!step.id.startsWith("decision-") && <pre className="whitespace-pre-wrap break-words text-xs">{step.prompt}</pre>}</>}
        {r.error && <p className="text-sm text-destructive">{r.error}</p>}
        <div className="flex flex-wrap gap-2">
          {["ready", "approval", "recovery_required"].includes(r.status) && step && <Button disabled={busy} onClick={() => {
            if (r.status === "recovery_required" && !window.confirm("¿Repetir la operación? Puede duplicar acciones o cobros.")) return;
            action((c) => advanceAdaptive(c, projectId, r.id, r.status === "approval" ? step.id : undefined, r.status === "recovery_required"));
          }}>{r.status === "approval" ? "Aprobar esta acción" : r.status === "recovery_required" ? "Confirmar reintento" : "Revisar siguiente acción"}</Button>}
          {!["completed", "cancelled", "running"].includes(r.status) && <Button variant="outline" disabled={busy} onClick={() => action((c) => runs.cancel(c.repo, projectId, r.id))}>Detener</Button>}
        </div>
      </article>;
    })}
  </section>;
}