import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import type { JobStatus } from "@/lib/core/jobs";
import { NeedProject } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { pollRemoteJob, cancelRemoteJob } from "@/lib/core/remote-jobs";

export const Route = createFileRoute("/jobs")({
  head: () => ({
    meta: [
      { title: "Trabajos — MI AI" },
      { name: "description", content: "Cola, progreso y recuperación de trabajos de IA por proyecto." },
      { property: "og:title", content: "Trabajos — MI AI" },
      { property: "og:description", content: "Estado de cada operación de IA, con reintentos controlados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Jobs,
});

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "En cola", submitting: "Enviando", processing: "Procesando", completed: "Completado", failed: "Fallido",
  cancelled: "Cancelado", interrupted: "Interrumpido", recovery_required: "Recuperación pendiente",
};

function Jobs() {
  const pid = useActiveProjectId();
  const [filter, setFilter] = useState<JobStatus | "">("");
  const { data: jobs = [] } = useCoreQuery(["jobs", pid, filter], (c) => c.jobs.list(pid!, filter || undefined), !!pid);
  const { data: startup } = useCoreQuery(["startup"], async (c) => c.startup);
  const mutate = useCoreMutate();
  if (!pid) return <NeedProject />;

  async function retry(id: string, status: JobStatus) {
    const ask = status === "recovery_required";
    if (ask && !confirm("El proveedor pudo haber procesado y cobrado este trabajo. Revisa tu cuenta del proveedor. ¿Marcarlo para reintentar de todas formas?")) return;
    try { await mutate((c) => c.jobs.retry(pid!, id, ask)); toast.success("Marcado para reintentar. Vuelve a ejecutarlo desde la Biblioteca."); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="space-y-3 p-4">
      <h1 className="text-2xl font-bold">Trabajos</h1>
      {startup && (startup.needsUser > 0 || startup.requeued > 0 || startup.temps > 0) && (
        <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-xs">Al abrir: {startup.needsUser} con recuperación pendiente, {startup.requeued} devueltos a la cola, {startup.temps} temporales incompletos eliminados.</p>
      )}
      <div className="flex flex-wrap gap-1">
        {(["", ...Object.keys(STATUS_LABEL)] as (JobStatus | "")[]).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`rounded-full border px-2 py-1 text-xs ${filter === s ? "border-primary bg-primary text-primary-foreground" : ""}`}>{s ? STATUS_LABEL[s] : "Todos"}</button>
        ))}
      </div>
      {!jobs.length && <p className="text-center text-sm text-muted-foreground">Sin trabajos.</p>}
      {jobs.map((j) => (
        <div key={j.id} className="space-y-1 rounded-xl border bg-card p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs">{j.capability_id}</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${j.status === "failed" || j.status === "recovery_required" ? "bg-destructive/15 text-destructive" : j.status === "completed" ? "bg-primary/15 text-primary" : "bg-secondary"}`}>{STATUS_LABEL[j.status]}</span>
          </div>
          <p className="text-xs text-muted-foreground">Creado {new Date(j.created_at).toLocaleString()} · intentos {j.attempts} · fase {j.phase}</p>
          {j.error && <p className="break-words text-xs text-destructive">{j.error}</p>}
          {j.recovery && <p className="break-words text-xs">{j.recovery}</p>}
          <div className="flex gap-2">
            {j.remote_id && ["processing", "interrupted", "recovery_required"].includes(j.status) && <Button size="sm" variant="outline" onClick={async () => { try { await mutate(async (c) => { const result = await pollRemoteJob(c, j.project_id, j.id); toast.success(result.pending ? "Sigue procesando" : "Resultado guardado en Biblioteca"); }); } catch (e) { toast.error(e instanceof Error ? e.message : "Consulta fallida"); } }}>Consultar</Button>}
            {j.remote_id && j.status === "processing" && <Button size="sm" variant="outline" onClick={async () => { if (!confirm("¿Solicitar cancelación al proveedor? No garantiza reembolso.")) return; try { await mutate((c) => cancelRemoteJob(c, j.project_id, j.id)); } catch (e) { toast.error(e instanceof Error ? e.message : "Cancelación no confirmada"); } }}>Cancelar</Button>}
            {["failed", "recovery_required", "interrupted"].includes(j.status) && <Button size="sm" variant="outline" onClick={() => retry(j.id, j.status)}><RotateCcw /> Reintentar</Button>}
            {!["submitting", "processing"].includes(j.status) && <Button size="sm" variant="ghost" onClick={() => mutate((c) => c.jobs.delete(pid!, j.id))}><Trash2 /> Quitar</Button>}
          </div>
        </div>
      ))}
    </div>
  );
}
