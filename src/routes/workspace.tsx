import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Briefcase, File, FolderOpen, Plus, Star, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NeedProject, inputCls } from "@/components/AppShell";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { workspace, type WorkspaceItem } from "@/lib/workspace";
import { extractText } from "@/lib/docs/extract";
import { saveExport } from "@/lib/save-export";
import type { Core } from "@/lib/core";
export const Route = createFileRoute("/workspace")({ head: () => ({ meta: [
  { title: "Espacio profesional — MI AI" }, { name: "description", content: "Archivos, entregables, herramientas y planificación por proyecto." },
  { property: "og:title", content: "Espacio profesional — MI AI" }, { property: "og:description", content: "Organiza documentos y herramientas de trabajo en tu teléfono." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: Page });
const LINKS = [
  { to: "/documents", label: "Documentos" }, { to: "/data", label: "Datos y presupuestos" },
  { to: "/code", label: "Editor" }, { to: "/servers", label: "Terminal y servidores" },
  { to: "/github", label: "GitHub" },
  { to: "/notes", label: "Notas y tareas" }, { to: "/research", label: "Investigación" },
  { to: "/agents", label: "Agentes" }, { to: "/automation", label: "Flujos" },
  { to: "/library", label: "Biblioteca" }, { to: "/jobs", label: "Trabajos" },
] as const;
const STATUS: Record<WorkspaceItem["status"], string> = { todo: "Pendiente", doing: "En curso", review: "Revisión", done: "Terminado" };
function Page() { const pid = useActiveProjectId(); return pid ? <Workspace key={pid} pid={pid} /> : <NeedProject />; }
function Workspace({ pid }: { pid: string }) {
  const mutate = useCoreMutate();
  const { data: project } = useCoreQuery(["project", pid], (c) => c.repo.getProject(pid));
  const { data: files = [] } = useCoreQuery(["workspace-files", pid], (c) => c.assets.list(pid));
  const { data: items = [] } = useCoreQuery(["workspace", pid], (c) => workspace.list(c.repo, pid));
  const { data: favorites = [] } = useCoreQuery(["favorites", pid], (c) => workspace.favorites(c.repo, pid));
  const [tab, setTab] = useState("tools"), [q, setQ] = useState(""), [title, setTitle] = useState(""), [selected, setSelected] = useState("");
  const [preview, setPreview] = useState(""), [busy, setBusy] = useState(false);
  const upload = useRef<HTMLInputElement | null>(null);
  async function act(fn: (c: Core) => Promise<unknown>) { setBusy(true); try { await mutate(fn); } catch (e) { toast.error(e instanceof Error ? e.message : "No se completó."); } finally { setBusy(false); } }
  return <div className="space-y-4 p-4">
    <div className="flex items-center gap-2"><Briefcase className="text-primary" /><h1 className="text-2xl font-bold">Espacio profesional</h1></div>
    <p className="text-sm text-muted-foreground">{project?.name}</p>
    <div className="flex flex-wrap gap-2">{[{ id: "tools", label: "Herramientas" }, { id: "files", label: "Archivos" }, { id: "board", label: "Entregables" }].map((t) => <Button key={t.id} variant={tab === t.id ? "default" : "outline"} onClick={() => setTab(t.id)}>{t.label}</Button>)}</div>
    {tab !== "board" && <input aria-label="Buscar en espacio profesional" className={inputCls} placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />}
    {tab === "tools" && <div className="grid grid-cols-2 gap-2">{[...LINKS].sort((a, b) => Number(favorites.some((f) => f.tool === b.to)) - Number(favorites.some((f) => f.tool === a.to))).filter((x) => x.label.toLowerCase().includes(q.toLowerCase())).map((x) => <div key={x.to} className="flex items-center gap-1 rounded-lg border bg-card p-2"><Link to={x.to} className="min-w-0 flex-1 break-words py-2 text-sm font-medium">{x.label}</Link><Button size="icon" variant="ghost" aria-label={`Favorito ${x.label}`} onClick={() => act((c) => workspace.favorite(c.repo, pid, x.to, !favorites.some((f) => f.tool === x.to)))}><Star className={favorites.some((f) => f.tool === x.to) ? "fill-primary text-primary" : "text-muted-foreground"} /></Button></div>)}</div>}
    {tab === "files" && <div className="space-y-3">
      <input type="file" ref={upload} className="hidden" aria-label="Subir archivo profesional" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; act(async (c) => { if (f.size > 50 * 1024 * 1024) throw new Error("Máximo 50 MB."); await c.assets.put(pid, (async function* () { yield new Uint8Array(await f.arrayBuffer()); })(), { kind: "document", mime: f.type || "application/octet-stream", name: f.name }); }); e.target.value = ""; }} />
      <Button variant="outline" disabled={busy} onClick={() => upload.current?.click()}><Upload />Subir archivo</Button>
      {files.filter((f) => (f.name ?? "").toLowerCase().includes(q.toLowerCase())).map((f) => <div key={f.id} className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2"><File className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 flex-1 break-words text-sm">{f.name ?? f.id}</span><span className="text-xs text-muted-foreground">v{f.version}</span></div>
        <div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={busy} onClick={() => act(async (c) => { const r = await extractText(await c.assets.read(pid, f.id), f.name ?? "", f.mime); setPreview(r.text.slice(0, 40000)); })}><FolderOpen />Abrir</Button>
          <Button size="sm" variant="outline" onClick={() => { setSelected(f.id); setTitle(f.name ?? "Entregable"); setTab("board"); }}>Vincular</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm("¿Exportar una copia sin cifrar de este archivo?") && act(async (c) => { await saveExport(await c.assets.read(pid, f.id), f.name ?? "archivo", f.mime); })}>Exportar</Button>
          <Button size="icon" variant="ghost" aria-label={`Eliminar archivo ${f.name}`} onClick={() => confirm("¿Eliminar este archivo?") && act((c) => c.assets.remove(pid, f.id))}><Trash2 /></Button>
        </div>
      </div>)}
      {preview && <div className="space-y-2 border-t pt-2"><Button variant="ghost" onClick={() => setPreview("")}>Cerrar archivo</Button><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{preview}</pre></div>}
    </div>}
    {tab === "board" && <div className="space-y-3">
      <input aria-label="Título del entregable" className={inputCls} placeholder="Nuevo entregable" value={title} onChange={(e) => setTitle(e.target.value)} />
      <select aria-label="Archivo del entregable" className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Sin archivo</option>{files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      <Button disabled={busy || !title.trim()} onClick={() => act(async (c) => { await workspace.add(c, pid, title, "deliverable", selected || undefined); setTitle(""); setSelected(""); })}><Plus />Añadir entregable</Button>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{(Object.keys(STATUS) as WorkspaceItem["status"][]).map((status) => <section key={status} className="space-y-2 border-t pt-2"><h2 className="text-sm font-semibold">{STATUS[status]}</h2>{items.filter((x) => x.status === status).map((x) => <div key={x.id} className="space-y-2 rounded-lg border bg-card p-3"><div className="flex items-start gap-2"><p className="min-w-0 flex-1 break-words text-sm">{x.title}</p><Button size="icon" variant="ghost" aria-label={`Eliminar entregable ${x.title}`} onClick={() => act((c) => workspace.remove(c.repo, pid, x.id))}><Trash2 /></Button></div><select aria-label={`Estado ${x.title}`} className={inputCls} value={x.status} onChange={(e) => { const target = e.target.value as WorkspaceItem["status"]; act((c) => workspace.move(c.repo, pid, x.id, target)); }}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{x.asset_id && <Link to="/library" className="text-xs text-primary underline">Archivo vinculado</Link>}</div>)}</section>)}</div>
    </div>}
  </div>;
}