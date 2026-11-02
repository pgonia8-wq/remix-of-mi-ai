import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pin, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { askModel } from "@/lib/core/ai";
import { notes, parseTaskLines, tasks, type Note } from "@/lib/core/productivity";
import { NeedProject, inputCls } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/notes")({
  head: () => ({
    meta: [
      { title: "Notas y tareas — MI AI" },
      { name: "description", content: "Notas y tareas por proyecto, guardadas cifradas en tu teléfono." },
      { property: "og:title", content: "Notas y tareas — MI AI" },
      { property: "og:description", content: "Organiza notas y pendientes; convierte textos en tareas con IA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotesPage,
});

function NotesPage() {
  const pid = useActiveProjectId();
  const [tab, setTab] = useState<"notes" | "tasks">("notes");
  if (!pid) return <NeedProject />;
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-bold">Notas y tareas</h1>
      <div className="flex gap-1">{(["notes", "tasks"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${tab === t ? "border-primary bg-primary text-primary-foreground" : ""}`}>{t === "notes" ? "Notas" : "Tareas"}</button>)}</div>
      {tab === "notes" ? <Notes pid={pid} /> : <Tasks pid={pid} />}
    </div>
  );
}

function Notes({ pid }: { pid: string }) {
  const [q, setQ] = useState("");
  const { data: list = [] } = useCoreQuery(["notes", pid, q], (c) => notes.list(c.repo.sql, pid, q));
  const mutate = useCoreMutate();
  const [edit, setEdit] = useState<Partial<Note> | null>(null);
  async function save() {
    if (!edit?.body?.trim() && !edit?.title?.trim()) { setEdit(null); return; }
    await mutate((c) => notes.save(c.repo.sql, pid, { ...(edit.id ? { id: edit.id } : {}), title: edit.title ?? "", body: edit.body ?? "", pinned: !!edit.pinned }));
    setEdit(null);
  }
  if (edit) return (
    <div className="space-y-2">
      <input className={inputCls} placeholder="Título" value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
      <textarea className={inputCls} rows={12} placeholder="Escribe tu nota…" value={edit.body ?? ""} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!edit.pinned} onChange={(e) => setEdit({ ...edit, pinned: e.target.checked ? 1 : 0 })} /> Fijar arriba</label>
      <div className="flex gap-2"><Button className="flex-1" onClick={save}>Guardar</Button><Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button></div>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="flex gap-2"><input className={inputCls} placeholder="Buscar notas" value={q} onChange={(e) => setQ(e.target.value)} /><Button aria-label="Crear nota" title="Crear nota" onClick={() => setEdit({})}><Plus /></Button></div>
      {list.map((n) => (
        <div key={n.id} className="flex items-start gap-2 rounded-xl border bg-card p-3 text-sm">
          <button className="min-w-0 flex-1 text-left" onClick={() => setEdit(n)}>
            <div className="flex items-center gap-1 font-medium">{n.pinned ? <Pin className="h-3 w-3 text-primary" /> : null}<span className="truncate">{n.title}</span></div>
            <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
          </button>
          <button aria-label="Eliminar nota" onClick={() => confirm("¿Eliminar nota?") && mutate((c) => notes.remove(c.repo.sql, pid, n.id))}><Trash2 className="h-4 w-4 text-muted-foreground" /></button>
        </div>
      ))}
      {!list.length && <p className="text-center text-xs text-muted-foreground">Sin notas.</p>}
    </div>
  );
}

function Tasks({ pid }: { pid: string }) {
  const { data: list = [] } = useCoreQuery(["tasks", pid], (c) => tasks.list(c.repo.sql, pid));
  const mutate = useCoreMutate();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState(2);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    try { await mutate((c) => tasks.add(c.repo.sql, pid, { title, dueAt: due ? new Date(`${due}T12:00:00`).getTime() : null, priority })); setTitle(""); setDue(""); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function fromText() {
    if (!source.trim()) return;
    setBusy(true);
    try {
      const c = await getCore();
      const r = await askModel(c, pid, `Extrae las tareas concretas y accionables de este texto. Devuelve solo una lista con el formato "- [ ] tarea", una por línea, en español.\n\n${source.slice(0, 30_000)}`);
      const items = parseTaskLines(r.text);
      if (!items.length) { toast.error("No se encontraron tareas en el texto."); return; }
      for (const t of items) await tasks.add(c.repo.sql, pid, { title: t });
      await mutate(async () => undefined);
      setSource("");
      toast.success(`${items.length} tareas agregadas`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const PR = ["", "Alta", "Media", "Baja"];
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <input className={inputCls} placeholder="Nueva tarea" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <div className="flex gap-2">
          <input aria-label="Fecha límite" type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
          <select aria-label="Prioridad" className={inputCls + " w-28"} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>{[1, 2, 3].map((p) => <option key={p} value={p}>{PR[p]}</option>)}</select>
          <Button onClick={add} disabled={!title.trim()}><Plus /></Button>
        </div>
      </div>
      {list.map((t) => {
        const overdue = !t.done && t.due_at && t.due_at < Date.now() - 43_200_000;
        return (
          <div key={t.id} className="flex items-center gap-2 rounded-xl border bg-card p-2 text-sm">
            <input type="checkbox" aria-label={`Completar ${t.title}`} checked={!!t.done} onChange={(e) => mutate((c) => tasks.toggle(c.repo.sql, pid, t.id, e.target.checked))} />
            <span className={`flex-1 ${t.done ? "text-muted-foreground line-through" : ""}`}>{t.title}</span>
            {t.due_at && <span className={`text-[10px] ${overdue ? "text-destructive" : "text-muted-foreground"}`}>{new Date(t.due_at).toLocaleDateString()}</span>}
            <span className="text-[10px] text-muted-foreground">{PR[t.priority]}</span>
            <button aria-label="Eliminar tarea" onClick={() => mutate((c) => tasks.remove(c.repo.sql, pid, t.id))}><Trash2 className="h-4 w-4 text-muted-foreground" /></button>
          </div>
        );
      })}
      {!list.length && <p className="text-center text-xs text-muted-foreground">Sin tareas.</p>}
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <p className="text-xs font-medium">Sacar tareas de un texto con IA</p>
        <textarea className={inputCls} rows={4} placeholder="Pega un correo, minuta o notas…" value={source} onChange={(e) => setSource(e.target.value)} />
        <Button className="w-full" variant="outline" disabled={busy || !source.trim()} onClick={fromText}><Sparkles />{busy ? "Extrayendo…" : "Extraer tareas"}</Button>
      </div>
    </div>
  );
}
