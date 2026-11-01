import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowDown, Play, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NeedProject, inputCls } from "@/components/AppShell";
import { useActiveProjectId, useCoreQuery, useCoreMutate } from "@/lib/use-app";
import { agents, workflows, runs, TOOLS, type Flow, type Step, type Workflow, type Run } from "@/lib/automation/store";
import { advance } from "@/lib/automation/runner";
import { planFlow } from "@/lib/automation/planner";
import { delegatePlan, runUntilPause, schedules } from "@/lib/automation/control";
import { reviewRun } from "@/lib/automation/review";

export const Route = createFileRoute("/automation")({ head: () => ({ meta: [
  { title: "Automatización — MI AI" }, { name: "description", content: "Flujos multimodelo con aprobaciones, condiciones e historial local." },
  { property: "og:title", content: "Automatización — MI AI" }, { property: "og:description", content: "Secuencias de agentes y herramientas por proyecto." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: Page });
const fresh = (): Step => ({ id: crypto.randomUUID(), name: "Nuevo paso", tool: "chat", prompt: "{{previous}}", agentId: null, approval: true, contains: "", repeat: 1 });
function Page() { const pid = useActiveProjectId(); return pid ? <Automation key={pid} pid={pid} /> : <NeedProject />; }
function Automation({ pid }: { pid: string }) {
  const { data: list = [] } = useCoreQuery(["workflows", pid], (c) => workflows.list(c.repo, pid));
  const { data: history = [] } = useCoreQuery(["runs", pid], (c) => runs.list(c.repo, pid));
  const { data: team = [] } = useCoreQuery(["agents", pid], (c) => agents.list(c.repo, pid));
  const mutate = useCoreMutate();
  const { data: scheduled = [] } = useCoreQuery(["schedules", pid], (c) => schedules.list(c.repo, pid));
  const [due, setDue] = useState("");
  const [tab, setTab] = useState("flows"), [edit, setEdit] = useState<string | null>(null), [name, setName] = useState("");
  const [flow, setFlow] = useState<Flow>({ steps: [], maxCalls: 5 }), [goal, setGoal] = useState(""), [input, setInput] = useState(""), [busy, setBusy] = useState(false);
  function open(w?: Workflow) { setEdit(w?.id ?? "new"); setName(w?.name ?? ""); setFlow(w ? JSON.parse(w.definition) as Flow : { steps: [fresh()], maxCalls: 5 }); }
  function patch(id: string, p: Partial<Step>) { setFlow({ ...flow, steps: flow.steps.map((s) => s.id === id ? { ...s, ...p } : s) }); }
  async function action(fn: Parameters<typeof mutate>[0]) { setBusy(true); try { await mutate(fn); } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo completar."); } finally { setBusy(false); } }
  return <div className="space-y-4 p-4">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Automatización</h1><Button aria-label="Nuevo flujo" onClick={() => { open(); setTab("flows"); }}><Plus /></Button></div>
    <div className="flex gap-2"><Button variant={tab === "flows" ? "default" : "outline"} onClick={() => setTab("flows")}>Flujos</Button><Button variant={tab === "history" ? "default" : "outline"} onClick={() => setTab("history")}>Historial</Button></div>
    {tab === "history" ? <div className="space-y-3">{history.map((r) => <RunItem key={r.id} pid={pid} run={r} busy={busy} action={action} />)}{!history.length && <p className="text-sm text-muted-foreground">Sin ejecuciones.</p>}</div> : edit ? <div className="space-y-3">
      <label className="block text-sm">Nombre del flujo<input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block text-sm">Máximo de solicitudes<input type="number" className={inputCls} min={1} max={20} value={flow.maxCalls} onChange={(e) => setFlow({ ...flow, maxCalls: Number(e.target.value) })} /></label>
      {flow.steps.map((s, i) => <div key={s.id} className="space-y-2 border-l-2 border-primary pl-3">
        <div className="flex gap-2"><span className="pt-2 text-sm font-bold">{i + 1}</span><input aria-label={`Nombre paso ${i + 1}`} className={inputCls} value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })} /><Button variant="ghost" size="icon" aria-label={`Eliminar paso ${i + 1}`} onClick={() => setFlow({ ...flow, steps: flow.steps.filter((x) => x.id !== s.id) })}><Trash2 /></Button></div>
        <select aria-label={`Herramienta paso ${i + 1}`} className={inputCls} value={s.tool} onChange={(e) => patch(s.id, { tool: e.target.value as Step["tool"] })}>{TOOLS.map((t) => <option key={t}>{t}</option>)}</select>
        <select aria-label={`Agente paso ${i + 1}`} className={inputCls} value={s.agentId ?? ""} onChange={(e) => patch(s.id, { agentId: e.target.value || null })}><option value="">Sin agente</option>{team.filter((a) => a.enabled).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <textarea aria-label={`Instrucción paso ${i + 1}`} className={inputCls} rows={3} value={s.prompt} onChange={(e) => patch(s.id, { prompt: e.target.value })} />
        <input aria-label={`Condición paso ${i + 1}`} className={inputCls} placeholder="Solo si el resultado anterior contiene…" value={s.contains} onChange={(e) => patch(s.id, { contains: e.target.value })} />
        <label className="flex items-center gap-2 text-xs">Repeticiones<input className={inputCls + " max-w-20"} type="number" min={1} max={3} value={s.repeat} onChange={(e) => patch(s.id, { repeat: Number(e.target.value) })} /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={s.approval} onChange={(e) => patch(s.id, { approval: e.target.checked })} />Pausar para aprobación</label>
        <select aria-label={`Rama si cumple paso ${i + 1}`} className={inputCls} value={s.next === null ? "end" : s.next ?? ""} onChange={(e) => patch(s.id, { next: e.target.value === "end" ? null : e.target.value || undefined })}><option value="">Continuar al siguiente</option><option value="end">Terminar flujo</option>{flow.steps.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select aria-label={`Rama si no cumple paso ${i + 1}`} className={inputCls} value={s.otherwise === null ? "end" : s.otherwise ?? ""} onChange={(e) => patch(s.id, { otherwise: e.target.value === "end" ? null : e.target.value || undefined })}><option value="">Siguiente si no cumple</option><option value="end">Terminar si no cumple</option>{flow.steps.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        {i > 0 && <fieldset className="space-y-1"><legend className="text-xs">Dependencias</legend>{flow.steps.slice(0, i).map((x) => <label key={x.id} className="flex gap-2 text-xs"><input type="checkbox" checked={s.dependsOn?.includes(x.id) ?? false} onChange={(e) => patch(s.id, { dependsOn: e.target.checked ? [...(s.dependsOn ?? []), x.id] : s.dependsOn?.filter((d) => d !== x.id) })} />{x.name}</label>)}</fieldset>}
        {i < flow.steps.length - 1 && <ArrowDown className="h-4 w-4 text-muted-foreground" />}
      </div>)}
      <Button variant="outline" disabled={flow.steps.length >= 20} onClick={() => setFlow({ ...flow, steps: [...flow.steps, fresh()] })}><Plus />Paso</Button>
      <div className="flex gap-2"><Button disabled={busy || !name.trim() || !flow.steps.length} onClick={() => action(async (c) => { await workflows.save(c.repo, pid, name, flow, edit === "new" ? undefined : edit); setEdit(null); })}><Save />Guardar flujo</Button><Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button></div>
      <textarea className={inputCls} placeholder="Objetivo del flujo" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} />
      <Button variant="outline" disabled={busy || !goal.trim()} onClick={() => action(async (c) => { setFlow(await planFlow(c, pid, goal)); })}><Sparkles />Proponer pasos con IA</Button>
      <Button variant="outline" disabled={busy || !goal.trim() || !team.length} onClick={() => action(async (c) => { setFlow(await delegatePlan(c, pid, goal)); })}><Sparkles />Distribuir al equipo</Button>
    </div> : <div className="space-y-3">
      <textarea aria-label="Entrada de la ejecución" className={inputCls} rows={3} placeholder="Entrada de la ejecución" value={input} onChange={(e) => setInput(e.target.value)} />
      <label className="block text-xs">Fecha de programación<input type="datetime-local" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></label>
      {due && <select aria-label="Programar flujo" className={inputCls} value="" onChange={(e) => e.target.value && action(async (c) => { await schedules.add(c.repo, pid, e.target.value, new Date(due).getTime(), input); setDue(""); })}><option value="">Elige el flujo a programar</option>{list.filter((w) => w.enabled).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
      {scheduled.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-2 border-b py-2 text-xs"><span>{new Date(s.due_at).toLocaleString()} · {s.status}</span><Button size="sm" variant="outline" disabled={s.status !== "scheduled" || s.due_at > Date.now() || busy} onClick={() => action(async (c) => { await schedules.start(c.repo, pid, s.id); setTab("history"); })}>Abrir ejecución</Button><Button variant="ghost" size="icon" aria-label="Eliminar programación" onClick={() => action((c) => schedules.remove(c.repo, pid, s.id))}><Trash2 /></Button></div>)}
      {scheduled.length > 0 && <p className="text-xs text-muted-foreground">Android puede avisar con la app cerrada; el sistema puede retrasar el aviso. Las operaciones requieren abrir y autorizar.</p>}
      {list.map((w) => <div key={w.id} className="space-y-2 rounded-lg border bg-card p-3"><div className="flex items-center gap-2"><Button className="min-w-0 flex-1 justify-start truncate" variant="ghost" onClick={() => open(w)}>{w.name}</Button><input aria-label={`Activar ${w.name}`} type="checkbox" checked={!!w.enabled} onChange={(e) => action((c) => workflows.toggle(c.repo, pid, w.id, e.target.checked))} /><Button size="icon" variant="ghost" aria-label={`Eliminar ${w.name}`} onClick={() => confirm("¿Eliminar flujo?") && action((c) => workflows.remove(c.repo, pid, w.id))}><Trash2 /></Button></div><Button variant="outline" disabled={busy || !w.enabled} onClick={() => action(async (c) => { await runs.create(c.repo, pid, w.id, input); setTab("history"); })}><Play />Iniciar</Button></div>)}
      {!list.length && <p className="text-sm text-muted-foreground">Sin flujos.</p>}
    </div>}
  </div>;
}
function RunItem({ pid, run: r, busy, action }: { pid: string; run: Run; busy: boolean; action: (fn: Parameters<ReturnType<typeof useCoreMutate>>[0]) => Promise<void> }) {
  const { data: events = [] } = useCoreQuery(["events", pid, r.id, r.updated_at], (c) => runs.events(c.repo, pid, r.id));
  const [show, setShow] = useState(false);
  const [review, setReview] = useState<{ conflicts: string[]; recommendation: string } | null>(null);
  const flow = JSON.parse(r.definition) as Flow;
  const uncertain = ["failed", "recovery_required"].includes(r.status);
  return <div className="space-y-2 rounded-lg border bg-card p-3">
    <div className="flex justify-between text-sm"><span>Paso {r.cursor + (r.status === "completed" ? 0 : 1)} / {flow.steps.reduce((n, s) => n + s.repeat, 0)}</span><span className="text-primary">{r.status}</span></div>
    <p className="text-xs text-muted-foreground">Solicitudes: {r.calls} / {flow.maxCalls}</p>
    {r.error && <p className="text-xs text-destructive">{r.error}</p>}
    <div className="flex flex-wrap gap-2">
      {!["completed", "cancelled", "running"].includes(r.status) && <Button disabled={busy} onClick={() => { if (uncertain && !confirm("¿Repetir el paso? Puede duplicar acciones y costes.")) return; if (r.status === "approval" && !confirm("¿Autorizar esta operación y su posible coste?")) return; action((c) => advance(c, pid, r.id, r.status === "approval", uncertain)); }}><Play />{uncertain ? "Reintentar" : r.status === "approval" ? "Aprobar paso" : "Continuar"}</Button>}
      {!["completed", "cancelled", "running"].includes(r.status) && <Button variant="outline" disabled={busy} onClick={() => action((c) => runs.cancel(c.repo, pid, r.id))}>Cancelar</Button>}
      {r.status === "ready" && <Button variant="outline" disabled={busy} onClick={() => action((c) => runUntilPause(c, pid, r.id))}>Ejecutar hasta aprobación</Button>}
      <Button variant="ghost" onClick={() => setShow(!show)}>Historial</Button>
      {r.output && <Button variant="outline" disabled={busy} onClick={() => { if (!confirm("¿Enviar los resultados de este flujo al modelo para revisar conflictos? Puede tener coste.")) return; action(async (c) => { setReview(await reviewRun(c, pid, r.id)); }); }}>Revisar conflictos</Button>}
      {r.output && <Link to="/library" className="text-xs text-primary underline">Resultado en Biblioteca</Link>}
    </div>
    {show && <div className="space-y-1 border-t pt-2">{events.map((e) => <p key={e.id} className="break-words text-xs"><span className="text-muted-foreground">{new Date(e.created_at).toLocaleTimeString()} · {e.step_id} · {e.agent_id ? "Agente " + e.agent_id.slice(0, 8) : "Sin agente"}</span><br />{e.kind}: {e.detail}</p>)}</div>}
    {review && <div className="space-y-2 border-t pt-2 text-sm">{review.conflicts.map((c,i) => <p className="text-destructive" key={i}>{c}</p>)}<p>{review.recommendation}</p><p className="text-xs text-muted-foreground">Revisión propuesta; ninguna decisión se aplicó automáticamente.</p></div>}
  </div>;
}