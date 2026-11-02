import { useState } from "react";
import { MessageSquarePlus, Plus, Trash2, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { inputCls } from "./AppShell";
import { useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { ACTIONS, EVENTS, reactions, type ReactionAction, type ReactionEvent } from "@/lib/automation/reactions";
import { setChatHandoff } from "@/lib/share-handoff";

/** Rules that react on their own to new files and agent events with free local actions; AI actions are only proposed. */
export function ReactionsPanel({ pid }: { pid: string }) {
  const { data: rules = [] } = useCoreQuery(["reaction-rules", pid], (c) => reactions.list(c, pid));
  const { data: log = [] } = useCoreQuery(["reaction-log", pid], (c) => reactions.log(c, pid));
  const mutate = useCoreMutate(), navigate = useNavigate();
  const [f, setF] = useState<{ name: string; event: ReactionEvent; filter: string; action: ReactionAction; param: string }>({ name: "", event: "file.added", filter: "", action: "extract_text", param: "" });
  const act = (fn: Parameters<typeof mutate>[0]) => mutate(fn).catch((e: Error) => toast.error(e.message));
  const fileOnly = f.action === "tag" || f.action === "extract_text";
  const placeholder = { tag: "Etiqueta, p. ej. facturas", extract_text: "", task: "Título; usa {nombre}, p. ej. Revisar {nombre}", notify: "Mensaje; usa {nombre}", propose: "Qué proponer, p. ej. Resume {nombre} y extrae montos y fechas" }[f.action];

  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Cuando pase algo, MI AI hace sola acciones gratuitas en el teléfono. Las acciones con IA nunca se ejecutan solas: quedan como propuesta para que tú decidas.</p>
    <div className="space-y-2 rounded-xl border bg-card p-3">
      <input className={inputCls} aria-label="Nombre de la reacción" placeholder="Nombre (opcional)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <select className={inputCls} aria-label="Cuando" value={f.event} onChange={(e) => setF({ ...f, event: e.target.value as ReactionEvent, action: e.target.value !== "file.added" && fileOnly ? "notify" : f.action })}>{Object.entries(EVENTS).map(([k, v]) => <option key={k} value={k}>Cuando: {v}</option>)}</select>
      {f.event === "file.added" && <input className={inputCls} aria-label="Filtro de archivos" placeholder="Solo archivos: .pdf, image/, factura… (vacío = todos)" value={f.filter} onChange={(e) => setF({ ...f, filter: e.target.value })} />}
      <select className={inputCls} aria-label="Hacer" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value as ReactionAction })}>{Object.entries(ACTIONS).filter(([k]) => f.event === "file.added" || (k !== "tag" && k !== "extract_text")).map(([k, v]) => <option key={k} value={k}>Hacer: {v}</option>)}</select>
      {f.action !== "extract_text" && <input className={inputCls} aria-label="Detalle de la acción" placeholder={placeholder} value={f.param} onChange={(e) => setF({ ...f, param: e.target.value })} />}
      <Button onClick={() => act(async (c) => { await reactions.add(c, pid, f); setF({ ...f, name: "", param: "" }); toast.success("Reacción creada."); })}><Plus />Crear reacción</Button>
    </div>
    <div className="space-y-2">{rules.map((r) => <div key={r.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
      <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.name}</p><p className="truncate text-xs text-muted-foreground">{EVENTS[r.event]}{r.filter ? ` · ${r.filter}` : ""} → {ACTIONS[r.action]}{r.param ? ` · ${r.param}` : ""}</p></div>
      <input type="checkbox" aria-label={`Activar ${r.name}`} checked={!!r.enabled} onChange={(e) => act((c) => reactions.toggle(c, pid, r.id, e.target.checked))} />
      <Button size="icon" variant="ghost" aria-label={`Eliminar ${r.name}`} onClick={() => act((c) => reactions.remove(c, pid, r.id))}><Trash2 /></Button></div>)}
      {!rules.length && <p className="text-xs text-muted-foreground">Aún no hay reacciones.</p>}</div>
    {log.length > 0 && <div className="space-y-1"><h2 className="text-sm font-semibold">Actividad reciente</h2>{log.map((l) => { const subj = JSON.parse(l.subject) as { name: string }; return <div key={l.id} className="flex items-center gap-2 border-b py-1.5 text-xs">
      <span className={`shrink-0 rounded px-1.5 py-0.5 ${l.status === "error" ? "bg-destructive/15 text-destructive" : l.status === "propuesta" ? "bg-primary/15 text-primary" : "bg-muted"}`}>{l.status}</span>
      <span className="min-w-0 flex-1 truncate">{subj.name} · {l.detail}</span>
      {l.status === "propuesta" && <><Button size="sm" variant="outline" onClick={() => act(async (c) => { const chat = await c.repo.createChat(pid); setChatHandoff(chat.id, { text: l.detail, files: [] }); await reactions.dismiss(c, pid, l.id); await navigate({ to: "/chat/$chatId", params: { chatId: chat.id } }); })}><MessageSquarePlus />Abrir en chat</Button>
        <Button size="icon" variant="ghost" aria-label="Descartar propuesta" onClick={() => act((c) => reactions.dismiss(c, pid, l.id))}><X /></Button></>}
    </div>; })}</div>}
  </div>;
}
