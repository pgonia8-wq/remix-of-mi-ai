import { useState } from "react";
import { inputCls } from "./AppShell";
import { Button } from "./ui/button";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { submitAzureVideoTest, finishAzureVideoTest } from "@/lib/core/azure-video-verification";

export function AzureVideoModelForm({ providers }: { providers: { id: string; name: string; adapter: string }[] }) {
  const projectId = useActiveProjectId();
  const azure = providers.filter(p => p.adapter === "azure_openai");
  const [providerId, setProviderId] = useState(azure[0]?.id ?? "");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mutate = useCoreMutate();
  const { data: tests = [] } = useCoreQuery(["azure-video-tests", projectId], async core => projectId ? (await core.jobs.list(projectId)).filter(job => job.params?.includes('"verificationModel"') && !["failed", "cancelled"].includes(job.status)) : []);
  async function action(fn: Parameters<typeof mutate>[0]) {
    setBusy(true); setMessage("");
    try { await mutate(fn); } catch (error) { setMessage(error instanceof Error ? error.message : "Operación no confirmada."); } finally { setBusy(false); }
  }
  return <section className="space-y-3 border-t pt-3">
    <h2 className="font-semibold">Video Azure · Sora 2 v1</h2>
    <select aria-label="Conexión Azure de video" className={inputCls} disabled={busy} value={providerId} onChange={e => setProviderId(e.target.value)}><option value="">Seleccionar Azure</option>{azure.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <input aria-label="Deployment de video Azure" className={inputCls} disabled={busy} value={model} onChange={e => setModel(e.target.value)} placeholder="Modelo/deployment de video provisionado" />
    {!projectId && <p className="text-sm text-muted-foreground">Selecciona un proyecto para guardar la prueba.</p>}
    <Button variant="outline" disabled={busy || !projectId || !providerId || !model.trim()} onClick={() => {
      if (!projectId || !confirm("Esta prueba genera un video REAL de 4 segundos en Azure y puede tener costo. ¿Continuar?")) return;
      action(async core => { await submitAzureVideoTest(core, projectId, providerId, model.trim()); setMessage("Trabajo de prueba guardado. Consulta sin volver a generar."); });
    }}>Probar video</Button>
    {tests.map(job => <div key={job.id} className="flex flex-wrap items-center gap-2 text-xs"><span className="min-w-0 flex-1 break-all">{job.remote_id ?? job.id} · {job.status}</span><Button size="sm" variant="outline" disabled={busy || !projectId || !job.remote_id} onClick={() => {
      if (!projectId || !confirm("¿Consultar esta prueba y guardar el modelo únicamente si ya existe un MP4 real?")) return;
      action(async core => { const done = await finishAzureVideoTest(core, projectId, job.id); setMessage(done ? "Modelo verificado y guardado con su video cifrado." : "Azure sigue procesando; no se volvió a generar."); });
    }}>Consultar y guardar</Button></div>)}
    {message && <p role="status" className="break-words text-sm">{message}</p>}
  </section>;
}