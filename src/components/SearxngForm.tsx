import { useState } from "react";
import { toast } from "sonner";
import { inputCls } from "./AppShell";
import { Button } from "./ui/button";
import { useCoreMutate } from "@/lib/use-app";
import { verifyConnection, canSaveConnection, type DraftConnection, type DraftVerification } from "@/lib/core/connection-test";

export function SearxngForm({ onDone }: { onDone: () => void }) {
  const mutate = useCoreMutate();
  const [endpoint, setEndpoint] = useState("");
  const [verified, setVerified] = useState<DraftVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const draft: DraftConnection = { adapterId: "searxng", capability: "research.web", credentials: { kind: "searxng", endpoint: endpoint.trim(), apiKey: null, deployment: null, apiVersion: null, model: "search", extraParams: null } };
  async function test() {
    setBusy(true); setVerified(null);
    try { setVerified(await verifyConnection(draft)); } finally { setBusy(false); }
  }
  async function save() {
    if (busy || !canSaveConnection(draft, verified)) return;
    setBusy(true);
    try {
      await mutate(async core => {
        const id = await core.repo.saveProvider({ name: "SearXNG", kind: "searxng", endpoint: endpoint.trim(), model: "search" });
        const model = await core.repo.registry.upsertModel({ providerId: id, remoteId: "search", source: "manual" });
        await core.repo.registry.setModelCapabilities(model, ["research.web"]);
        await core.repo.setProviderVerification(id, "verified");
        await core.repo.registry.recordTest(model, "research.web", true, 200, "Resultados de búsqueda reales recibidos.");
      });
      toast.success("SearXNG guardado."); onDone();
    } catch { toast.error("No se pudo guardar el buscador."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 border-t pt-3">
    <label className="block text-sm">URL de SearXNG<input aria-label="URL de SearXNG" className={inputCls} type="url" disabled={busy} value={endpoint} onChange={event => { setEndpoint(event.target.value); setVerified(null); }} /></label>
    <p className="text-xs text-muted-foreground">Instancia propia o autorizada con JSON habilitado. Las instancias públicas pueden bloquear solicitudes o limitar su disponibilidad.</p>
    {verified && <p role="status" className="text-sm">{verified.message}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !endpoint.trim()} onClick={test}>{busy ? "Conectando…" : "Probar conexión"}</Button><Button disabled={busy || !canSaveConnection(draft, verified)} onClick={save}>Guardar buscador</Button><Button variant="ghost" disabled={busy} onClick={onDone}>Cancelar</Button></div>
  </div>;
}