import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2, Copy, Archive, ArchiveRestore, Check, Download, Upload, Wallet, Bluetooth } from "lucide-react";
import { getCore } from "@/lib/core";
import { exportProject, importProject, packForBluetooth, projectFileText, bluetoothName, BLUETOOTH_MIME } from "@/lib/core/project-transfer";
import { blobChunks, sendByBluetooth } from "@/lib/device";
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

async function readProjectUpload(f: File) {
  const parts: Uint8Array[] = []; let n = 0;
  for await (const c of blobChunks(f)) { parts.push(c); n += c.length; }
  const all = new Uint8Array(n); let o = 0; for (const c of parts) { all.set(c, o); o += c.length; }
  return projectFileText(all);
}

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
  const { data: status } = useRepoQuery(["budget", panel?.projectId ?? ""], (r) => r.budgetStatus(panel!.projectId!), panel?.mode === "budget");
  const { data: costs = [] } = useRepoQuery(["costs", panel?.projectId ?? ""], (r) => r.listCosts(panel!.projectId!, 10), panel?.mode === "budget");
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
  async function doExport(via: "file" | "bluetooth" = "file") {
    if (!panelProject) return;
    const st = passwordStrength(pw); if (!st.ok) { toast.error(st.hint); return; }
    setBusy(true);
    try {
      const core = await getCore();
      const mem = core.device.totalMemMB ? core.device.totalMemMB / 1024 : null;
      const text = await exportProject({ repo: core.repo, assets: core.assets, projectId: panelProject.id, password: pw, deviceMemGB: mem });
      if (via === "bluetooth") {
        const r = await sendByBluetooth({ data: await packForBluetooth(text, panelProject.name), name: bluetoothName(panelProject.name), mime: BLUETOOTH_MIME });
        toast.success(r === "downloaded" ? "Archivo listo: envíalo por Bluetooth desde tu teléfono" : "Elige el teléfono de destino. Allí ábrelo con «Importar proyecto» y la misma contraseña.");
      } else {
        await saveExport(new TextEncoder().encode(text), `${panelProject.name.replace(/[^\w-]+/g, "_")}.miaiproj`, "application/octet-stream");
        toast.success("Proyecto exportado y cifrado");
      }
      setPanel(null);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setPw(""); }
  }
  async function doImport(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const core = await getCore();
      const r = await importProject({ repo: core.repo, assets: core.assets, text: await readProjectUpload(f), password: pw });
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

  return (
    <div className="space-y-5 p-4">
      <h1 className="text-2xl font-bold">Proyectos</h1>
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <input className={inputCls} placeholder="Nombre del proyecto" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} placeholder="Descripción (opcional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button className={btnCls + " btn-graphite-glass w-full"} onClick={create} disabled={!name.trim()}>
          <Plus className="h-4 w-4" /> Crear proyecto
        </button>
      </div>
      {error && <p className="text-sm text-destructive">No se pudo abrir la base de datos: {String((error as Error).message)}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Abriendo base de datos cifrada…</p>}
      {panel && (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          {panel.mode === "budget" ? (
            <>
              <h2 className="font-semibold">Presupuesto mensual — {panelProject?.name}</h2>
              {status && <p className="text-xs text-muted-foreground">Gastado este mes: US$ {status.spentUsd.toFixed(2)}{status.includesEstimates ? " (incluye estimados)" : ""}. Aviso al 80% y bloqueo al 100%, con opción de confirmar.</p>}
              {costs.length > 0 && <ul className="space-y-0.5 text-xs text-muted-foreground">{costs.map((c) => <li key={c.id}>{new Date(c.created_at).toLocaleDateString()} · {c.operation} · {c.model ?? "—"} · {c.estimated === 2 ? "sin precio" : `US$ ${c.amount_usd.toFixed(4)}${c.estimated ? " (estimado)" : ""}`}</li>)}</ul>}
              <input className={inputCls} inputMode="decimal" placeholder="Límite en US$ (vacío = sin límite)" value={budget} onChange={(e) => setBudget(e.target.value)} />
              <div className="flex gap-2"><button className={btnCls + " flex-1"} onClick={saveBudget}>Guardar</button><button className="flex-1 text-sm underline" onClick={() => setPanel(null)}>Cancelar</button></div>
            </>
          ) : (
            <>
              <h2 className="font-semibold">{panel.mode === "export" ? `Exportar "${panelProject?.name}"` : "Importar proyecto"}</h2>
              <p className="text-xs text-muted-foreground">{panel.mode === "export" ? "Incluye chats, memoria, notas, tareas, documentos y archivos, cifrados con esta contraseña. Las API keys no se incluyen. «Bluetooth» lo envía a otro teléfono; allí se abre con «Importar proyecto» y la misma contraseña." : "Se crea un proyecto nuevo; nunca se mezcla con otro. Una contraseña incorrecta se rechaza sin cambiar nada."}</p>
              <input className={inputCls} type="password" placeholder="Contraseña del archivo" value={pw} onChange={(e) => setPw(e.target.value)} />
              {busy && <p className="text-xs text-primary">Procesando…</p>}
              <div className="flex gap-2">
                {panel.mode === "export"
                  ? <><button className={btnCls + " flex-1"} disabled={busy || !pw} onClick={() => doExport("file")}><Download className="h-4 w-4" /> Guardar</button><button className={btnCls + " flex-1"} disabled={busy || !pw} onClick={() => doExport("bluetooth")}><Bluetooth className="h-4 w-4" /> Bluetooth</button></>
                  : <label className={btnCls + " flex-1 cursor-pointer" + (busy || !pw ? " pointer-events-none opacity-50" : "")}><Upload className="h-4 w-4" /> Elegir archivo<input type="file" className="hidden" accept=".miaiproj,.zip,application/zip,application/octet-stream" onChange={(e) => doImport(e.target.files?.[0])} /></label>}
                <button className="flex-1 text-sm underline" onClick={() => setPanel(null)}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      )}
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
            {active === p.id && <Check className="h-4 w-4 text-success" />}
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
                await mutate(async (r) => {
                  // Close this project's tunnels (native SSH/VPN too) before its rows disappear.
                  const { tunnels } = await import("@/lib/nodes/tunnels");
                  for (const t of await tunnels.list(r, p.id)) if (t.status === "open") await tunnels.close(r, p.id, t.id, "proyecto eliminado").catch(() => undefined);
                  await r.deleteProject(p.id);
                });
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
