import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2, Copy, Archive, ArchiveRestore, Check } from "lucide-react";
import { toast } from "sonner";
import { setActiveProject, useActiveProjectId, useMutate, useRepoQuery } from "@/lib/use-app";
import { btnCls, inputCls } from "@/components/AppShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Proyectos — MI AI" },
      { name: "description", content: "Proyectos aislados con chats, memoria y documentos propios, guardados cifrados en tu teléfono." },
      { property: "og:title", content: "Proyectos — MI AI" },
      { property: "og:description", content: "Proyectos aislados con chats, memoria y documentos propios." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Projects,
});

function Projects() {
  const { data: projects = [], isLoading, error } = useRepoQuery(["projects"], (r) => r.listProjects());
  const active = useActiveProjectId();
  const mutate = useMutate();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const { data: archivedIds = [] } = useRepoQuery(["projects", "archived"], (r) => r.listArchivedProjectIds());
  const visible = projects.filter((p) => archivedIds.includes(p.id) === showArchived);

  async function create() {
    if (!name.trim()) return;
    const p = await mutate((r) => r.createProject(name.trim(), desc.trim()));
    setActiveProject(p.id);
    setName("");
    setDesc("");
    toast.success("Proyecto creado");
  }

  return (
    <div className="space-y-5 p-4">
      <h1 className="text-2xl font-bold">Proyectos</h1>
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <input className={inputCls} placeholder="Nombre del proyecto" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} placeholder="Descripción (opcional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button className={btnCls + " w-full"} onClick={create} disabled={!name.trim()}>
          <Plus className="h-4 w-4" /> Crear proyecto
        </button>
      </div>
      {error && <p className="text-sm text-destructive">No se pudo abrir la base de datos: {String((error as Error).message)}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Abriendo base de datos cifrada…</p>}
      <ul className="space-y-2">
        {visible.map((p) => (
          <li key={p.id} className={`flex items-center gap-3 rounded-xl border p-4 ${active === p.id ? "border-primary bg-accent/40" : "bg-card"}`}>
            <button
              className="flex-1 text-left"
              onClick={() => {
                setActiveProject(p.id);
                nav({ to: "/chats" });
              }}
            >
              <div className="font-medium">{p.name}</div>
              {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
            </button>
            {active === p.id && <Check className="h-4 w-4 text-primary" />}
            <button aria-label="Duplicar proyecto" className="text-muted-foreground" onClick={async () => { await mutate((r) => r.duplicateProject(p.id)); toast.success("Proyecto duplicado"); }}>
              <Copy className="h-4 w-4" />
            </button>
            <button aria-label={showArchived ? "Restaurar proyecto" : "Archivar proyecto"} className="text-muted-foreground" onClick={async () => { await mutate((r) => r.setProjectArchived(p.id, !showArchived)); toast.success(showArchived ? "Proyecto restaurado" : "Proyecto archivado"); }}>
              {showArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </button>
            <button
              aria-label="Eliminar proyecto"
              className="text-muted-foreground"
              onClick={async () => {
                if (!confirm(`¿Eliminar "${p.name}" y todo su contenido?`)) return;
                await mutate((r) => r.deleteProject(p.id));
                if (active === p.id) setActiveProject(null);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
        {!isLoading && !visible.length && <p className="text-center text-sm text-muted-foreground">{showArchived ? "No hay proyectos archivados." : "Aún no tienes proyectos."}</p>}
        <button className="w-full text-center text-sm text-muted-foreground underline" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Ver proyectos activos" : `Ver archivados (${archivedIds.length})`}</button>
      </ul>
    </div>
  );
}
