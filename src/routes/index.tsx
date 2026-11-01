import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2, Copy, Archive, ArchiveRestore, Check, Download, Upload, Wallet } from "lucide-react";
import { getCore } from "@/lib/core";
import { exportProject, importProject } from "@/lib/core/project-transfer";
import { passwordStrength } from "@/lib/core/backup";
import { saveExport } from "@/lib/save-export";
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
  const [panel, setPanel] = useState<{ mode: "export" | "import" | "budget"; projectId?: string } | null>(null);
  const [pw, setPw] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = projects.filter((p) => archivedIds.includes(p.id) === showArchived);

  async function create() {
    if (!name.trim()) return;
    const p = await mutate((r) => r.createProject(name.trim(), desc.trim()));
    setActiveProject(p.id);
    setName("");
    setDesc("");
    toast.success("Proyecto creado");
  }

  const panelProject = projects.find((x) => x.id === panel?.projectId);
  async function doExport() {
    if (!panelProject) return;
    const st = passwordStrength(pw); if (!st.ok) { toast.error(st.hint); return; }
    setBusy(true);
    try {
      const core = await getCore();
      const mem = core.device.totalMemMB ? core.device.totalMemMB / 1024 : null;
      const text = await exportProject({ repo: core.repo, assets: core.assets, projectId: panelProject.id, password: pw, deviceMemGB: mem });
      await saveExport(new TextEncoder().encode(text), `${panelProject.name.replace(/[^\w-]+/g, "_")}.miaiproj`, "application/octet-stream");
      toast.success("Proyecto exportado y cifrado"); setPanel(null);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setPw(""); }
  }
  async function doImport(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const core = await getCore();
      const r = await importProject({ repo: core.repo, assets: core.assets, text: await f.text(), password: pw });
      await mutate(async () => undefined);
      toast.success(`Proyecto "${r.project.name}" importado como proyecto nuevo`); setPanel(null);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setPw(""); }
  }
  async function saveBudget() {
    if (!panelProject) return;
    try {
      const v = budget.trim() ? Number(budget) : null;
      await mutate((r) => r.setProjectBudget(panelProject.id, v));
      toast.success(v ? "Presupuesto guardado" : "Presupuesto quitado"); setPanel(null);
    } catch (e) { toast.error((e as Error).message); }
  }
  function TransferPanel() {
    return null;
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
      {panel && <TransferPanel />}
      <button className="w-full text-center text-sm text-muted-foreground underline" onClick={() => { setPw(""); setPanel({ mode: "import" }); }}><Upload className="mr-1 inline h-4 w-4" />Importar proyecto desde archivo</button>
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
            <button aria-label="Presupuesto del proyecto" className="text-muted-foreground" onClick={async () => { const b = await mutate((r) => r.getProjectBudget(p.id)); setBudget(b ? String(b) : ""); setPanel({ mode: "budget", projectId: p.id }); }}>
              <Wallet className="h-4 w-4" />
            </button>
            <button aria-label="Exportar proyecto" className="text-muted-foreground" onClick={() => { setPw(""); setPanel({ mode: "export", projectId: p.id }); }}>
              <Download className="h-4 w-4" />
            </button>
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
