import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, FlaskConical, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { getAdapter } from "@/lib/core/adapters";
import { credentialsFor, testOperation, testDraftOperation } from "@/lib/core/executor";
import { canSaveConnection, verifyConnection, type DraftConnection, type DraftVerification } from "@/lib/core/connection-test";
import type { ModelWithCaps } from "@/lib/core/registry";
import { inputCls } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { MediaProviderForm } from "@/components/MediaProviderForm";
import { SearxngForm } from "@/components/SearxngForm";
import { AzureVideoModelForm } from "@/components/AzureVideoModelForm";
import { ModelsTransfer } from "@/components/ModelsTransfer";
import { AzureAutoSetup } from "@/components/AzureAutoSetup";
import { DefaultModels } from "@/components/DefaultModels";

export const Route = createFileRoute("/models")({
  head: () => ({
    meta: [
      { title: "Modelos y capacidades — MI AI" },
      { name: "description", content: "Registro universal de modelos: capacidades reales, pruebas y catálogo por proveedor." },
      { property: "og:title", content: "Modelos y capacidades — MI AI" },
      { property: "og:description", content: "Cada modelo declara sus capacidades reales y su estado de prueba." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Models,
});

function Models() {
  const { data } = useCoreQuery(["models"], async (c) => ({
    models: await c.repo.registry.listModels(),
    providers: await c.repo.registry.listProviders(),
    caps: await c.repo.registry.listCapabilities(),
  }));
  const mutate = useCoreMutate();
  const [adding, setAdding] = useState(false);
  const [eleven, setEleven] = useState(false);
  const [tavily, setTavily] = useState(false);
  const [media, setMedia] = useState(false);
  const [searxng, setSearxng] = useState(false);
  const [external, setExternal] = useState(false);
  const [azureVideo, setAzureVideo] = useState(false);
  const models = data?.models ?? [], providers = data?.providers ?? [], caps = data?.caps ?? [];

  async function importCatalog(providerId: string, adapterId: string) {
    const ad = getAdapter(adapterId);
    if (!ad.listModels) { toast.error(`${ad.label} no ofrece un catálogo oficial con tu API key; registra los modelos a mano.`); return; }
    try {
      await mutate(async (c) => {
        const { creds } = await credentialsFor(c.repo, providerId);
        if (!ad.listModels) return;
        const ids = await ad.listModels(creds);
        const r = await c.repo.registry.applyImport(providerId, ids);
        toast.success(`${r.added} modelos del catálogo oficial; ${r.retired} marcados como retirados. Asigna sus capacidades.`);
      });
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-bold">Modelos</h1>
      <AzureAutoSetup />
      <DefaultModels models={models} />
      <div className="flex flex-wrap gap-2"><ModelsTransfer /></div>

      <details className="rounded-xl border bg-card p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Configuración manual y otros proveedores</summary>
        <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">Solo si necesitas algo especial. Cada modelo muestra solo las capacidades que tú o su catálogo declaran. «Probar» hace una operación real con tu clave (puede tener costo).</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}><Plus /> Registrar modelo</Button><Button size="sm" variant="outline" onClick={() => setAzureVideo(v => !v)}>Video Azure</Button></div>
      {adding && <RegisterModel providers={providers} caps={caps.map((c) => c.id)} onDone={() => setAdding(false)} />}
      {azureVideo && <AzureVideoModelForm providers={providers} />}

      <section className="space-y-2 rounded-xl border bg-card p-3 text-sm">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Proveedores</h2>
          <Button size="sm" variant="outline" onClick={() => setSearxng(v => !v)}><Plus /> SearXNG</Button></div>
        {searxng && <SearxngForm onDone={() => setSearxng(false)} />}
        <Button variant="ghost" size="sm" onClick={() => setExternal(v => !v)}>Otros proveedores opcionales</Button>
        {external && <div className="space-y-2">
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setEleven(v => !v)}>ElevenLabs</Button><Button size="sm" variant="outline" onClick={() => setTavily(v => !v)}>Tavily</Button><Button size="sm" variant="outline" onClick={() => setMedia(v => !v)}>Música, video y 3D</Button></div>
          {tavily && <TavilyForm onDone={() => setTavily(false)} />}
          {eleven && <ElevenLabsForm onDone={() => setEleven(false)} />}
          {media && <MediaProviderForm onDone={() => setMedia(false)} />}
        </div>}
        {!providers.length && <p className="text-xs text-muted-foreground">Sin proveedores. Agrega uno en Ajustes.</p>}
        {providers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 border-t pt-2">
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{getAdapter(p.adapter).label} · {p.enabled ? "activo" : "desactivado"}</div></div>
            <Button size="sm" variant="ghost" onClick={() => importCatalog(p.id, p.adapter)}><Download /> Catálogo</Button>
          </div>
        ))}
      </section>
        </div>
      </details>

      {models.length > 0 && <h2 className="pt-2 font-semibold">Tus modelos</h2>}
      {models.map((m) => <ModelCard key={m.id} m={m} allCaps={caps.map((c) => c.id)} />)}
      {!models.length && <p className="text-center text-sm text-muted-foreground">Aún no hay modelos registrados.</p>}
    </div>
  );
}

function ModelCard({ m, allCaps }: { m: ModelWithCaps; allCaps: string[] }) {
  const mutate = useCoreMutate();
  const [editCaps, setEditCaps] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const supported = Object.keys(getAdapterForModel(m).operations);

  async function test(cap: string) {
    if (!confirm(`Se hará una operación REAL de «${cap}» con tu clave. Puede tener costo. ¿Continuar?`)) return;
    setBusy(cap);
    try {
      await mutate(async (c) => {
        const r = await testOperation(c.repo, m, cap);
        await c.repo.registry.recordTest(m.id, cap, r.ok, r.httpStatus, r.message);
        r.ok ? toast.success(`${cap}: operación real completada`) : toast.error(`${cap}: ${r.message}`);
      });
    } finally { setBusy(null); }
  }

  return (
    <div className={`space-y-2 rounded-xl border bg-card p-3 text-sm ${m.status === "retired" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="break-all font-medium">{m.name}</div>
          <div className="text-xs text-muted-foreground">{m.provider_name} · {m.source === "legacy" ? "desde Ajustes" : m.source === "import" ? "catálogo oficial" : "registro manual"} · {m.status === "retired" ? "retirado" : "activo"} · {m.privacy === "local" ? "local" : "externo"} · costo {m.cost_info ?? "desconocido"}</div>
        </div>
        <Button variant="ghost" size="icon" aria-label="Favorito" onClick={() => mutate((c) => c.repo.registry.setFavorite(m.id, !m.favorite))}><Star className={m.favorite ? "fill-primary text-primary" : ""} /></Button>
        {m.source !== "legacy" && <Button variant="ghost" size="icon" aria-label="Eliminar" onClick={() => confirm("¿Eliminar modelo del registro?") && mutate((c) => c.repo.registry.deleteModel(m.id))}><Trash2 /></Button>}
      </div>
      {m.capabilities.length === 0 && <p className="text-xs text-destructive">Sin capacidades: el selector nunca lo usará.</p>}
      <ul className="space-y-1">
        {m.capabilities.map((cap) => {
          const t = m.tests.find((x) => x.capability_id === cap);
          const can = supported.includes(cap);
          return (
            <li key={cap} className="flex items-center gap-2 rounded-md bg-secondary/50 px-2 py-1">
              <span className="font-mono text-xs">{cap}</span>
              <span className={`flex-1 text-right text-xs ${t?.status === "error" ? "text-destructive" : t?.status === "ok" ? "text-primary" : "text-muted-foreground"}`}>
                {!can ? "adaptador sin soporte" : t?.status === "ok" ? `Verificado ${new Date(t.checked_at).toLocaleDateString()}` : t?.status === "error" ? `Error${t.http_status ? ` HTTP ${t.http_status}` : ""}` : "Sin prueba real"}
              </span>
              {can && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => test(cap)}><FlaskConical />{busy === cap ? "…" : "Probar"}</Button>}
            </li>
          );
        })}
      </ul>
      {m.tests.filter((t) => t.status === "error").map((t) => <p key={t.capability_id} className="break-words text-xs text-destructive">{t.capability_id}: {t.message}</p>)}
      <button className="text-xs text-primary underline" onClick={() => setEditCaps((v) => !v)}>{editCaps ? "Cerrar" : "Editar capacidades"}</button>
      {editCaps && (
        <div className="grid grid-cols-2 gap-1">
          {allCaps.map((cap) => (
            <label key={cap} className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={m.capabilities.includes(cap)} onChange={(e) => mutate((c) => c.repo.registry.setModelCapabilities(m.id, e.target.checked ? [...m.capabilities, cap] : m.capabilities.filter((x) => x !== cap)))} />
              <span className="font-mono">{cap}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function getAdapterForModel(m: ModelWithCaps) {
  return getAdapter(m.adapter_id ?? (m.provider_kind === "azure" ? "azure_openai" : m.provider_kind));
}

function RegisterModel({ providers, caps, onDone }: { providers: { id: string; name: string; adapter: string }[]; caps: string[]; onDone: () => void }) {
  const mutate = useCoreMutate();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [remote, setRemote] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [cost, setCost] = useState("");
  const [tested, setTested] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const provider = providers.find(p => p.id === providerId);
  const availableCaps = caps.filter(cap => provider && getAdapter(provider.adapter).supports(cap));
  const fingerprint = JSON.stringify([providerId, remote.trim(), sel]);
  async function test() {
    if (!confirm("Se probarán las capacidades seleccionadas con solicitudes reales que pueden tener costo. ¿Continuar?")) return;
    setBusy(true); setTested(null);
    try {
      await mutate(async c => {
        const { creds, adapter } = await credentialsFor(c.repo, providerId);
        for (const cap of sel) {
          const result = await testDraftOperation(adapter, creds, remote.trim(), cap);
          if (!result.ok) throw new Error(`${cap}: ${result.message}`);
        }
      });
      setTested(fingerprint); setMessage("Capacidades verificadas con resultados reales.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "No se confirmó el resultado."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!providerId || !remote.trim() || !sel.length || busy || tested !== fingerprint) { toast.error("Prueba las capacidades antes de guardar."); return; }
    await mutate(async (c) => {
      const id = await c.repo.registry.upsertModel({ providerId, remoteId: remote.trim(), source: "manual", costInfo: cost.trim() || null });
      await c.repo.registry.setModelCapabilities(id, sel);
      for (const cap of sel) await c.repo.registry.recordTest(id, cap, true, 200, "Resultado real recibido antes de guardar.");
    });
    toast.success("Modelo registrado y verificado.");
    onDone();
  }
  return (
    <div className="space-y-2 rounded-xl border bg-card p-3 text-sm" aria-busy={busy}>
      <select aria-label="Proveedor del modelo" className={inputCls} value={providerId} onChange={(e) => { setProviderId(e.target.value); setSel([]); setTested(null); setMessage(""); }}>
        {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input className={inputCls} placeholder="Identificador oficial o deployment (p. ej. gpt-image-1)" value={remote} onChange={(e) => setRemote(e.target.value)} />
      <input className={inputCls} placeholder="Costo conocido (opcional, p. ej. «$0.04 por imagen»)" value={cost} onChange={(e) => setCost(e.target.value)} />
      <div className="grid grid-cols-2 gap-1">
        {availableCaps.map((c) => <label key={c} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={sel.includes(c)} onChange={(e) => setSel(e.target.checked ? [...sel, c] : sel.filter((x) => x !== c))} /><span className="font-mono">{c}</span></label>)}
      </div>
      {message && <p role="status" className="break-words text-sm">{message}</p>}
      <Button variant="outline" disabled={busy || !providerId || !remote.trim() || !sel.length} onClick={test}>Probar conexión</Button>
      <div className="flex gap-2"><Button disabled={busy || tested !== fingerprint} className="flex-1" onClick={save}>Guardar modelo</Button><Button disabled={busy} variant="outline" onClick={onDone}>Cancelar</Button></div>
    </div>
  );
}

function ElevenLabsForm({ onDone }: { onDone: () => void }) {
  const mutate = useCoreMutate();
  const [key, setKey] = useState("");
  const [verified, setVerified] = useState<DraftVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const draft: DraftConnection = { adapterId: "elevenlabs", capability: "audio.tts", credentials: { kind: "elevenlabs", model: "eleven_multilingual_v2", apiKey: key.trim(), endpoint: null, deployment: null, apiVersion: null, extraParams: null } };
  async function test() { if (!confirm("Prueba real de voz con posible costo. ¿Continuar?")) return; setBusy(true); setVerified(null); try { setVerified(await verifyConnection(draft)); } finally { setBusy(false); } }
  async function save() {
    if (busy || !canSaveConnection(draft, verified)) return;
    await mutate(async (c) => {
      const pid = await c.repo.saveProvider({ name: "ElevenLabs", kind: "elevenlabs", model: "eleven_multilingual_v2", apiKey: key.trim() });
      const mid = await c.repo.registry.upsertModel({ providerId: pid, remoteId: "eleven_multilingual_v2", source: "manual" });
      await c.repo.registry.setModelCapabilities(mid, ["audio.tts"]);
      await c.repo.setProviderVerification(pid, "verified");
      await c.repo.registry.recordTest(mid, "audio.tts", true, 200, "Audio real recibido antes de guardar.");
    });
    setKey("");
    toast.success("ElevenLabs guardado con la clave cifrada. Usa «Probar» en audio.tts.");
    onDone();
  }
  return (
    <div className="space-y-2">
      <input className={inputCls} type="password" autoComplete="off" placeholder="API key de ElevenLabs" value={key} onChange={(e) => setKey(e.target.value)} />
      {verified && <p role="status">{verified.message}</p>}
      <Button variant="outline" disabled={busy || !key.trim()} onClick={test}>Probar conexión</Button>
      <Button disabled={busy || !canSaveConnection(draft, verified)} className="w-full" onClick={save}>Guardar ElevenLabs</Button>
    </div>
  );
}

function TavilyForm({ onDone }: { onDone: () => void }) {
  const mutate = useCoreMutate();
  const [key, setKey] = useState("");
  const [verified, setVerified] = useState<DraftVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const draft: DraftConnection = { adapterId: "tavily", capability: "research.web", credentials: { kind: "tavily", model: "search", apiKey: key.trim(), endpoint: null, deployment: null, apiVersion: null, extraParams: null } };
  async function test() { if (!confirm("Prueba real de búsqueda con posible costo. ¿Continuar?")) return; setBusy(true); setVerified(null); try { setVerified(await verifyConnection(draft)); } finally { setBusy(false); } }
  async function save() {
    if (busy || !canSaveConnection(draft, verified)) return;
    await mutate(async (c) => {
      const pid = await c.repo.saveProvider({ name: "Tavily", kind: "tavily", model: "search", apiKey: key.trim() });
      const mid = await c.repo.registry.upsertModel({ providerId: pid, remoteId: "search", source: "manual" });
      await c.repo.registry.setModelCapabilities(mid, ["research.web"]);
      await c.repo.setProviderVerification(pid, "verified");
      await c.repo.registry.recordTest(mid, "research.web", true, 200, "Búsqueda real recibida antes de guardar.");
    });
    setKey("");
    toast.success("Buscador Tavily guardado con la clave cifrada. Usa «Probar» en research.web.");
    onDone();
  }
  return (
    <div className="space-y-2">
      <input className={inputCls} type="password" autoComplete="off" placeholder="API key de Tavily (tvly-…)" value={key} onChange={(e) => setKey(e.target.value)} />
      {verified && <p role="status">{verified.message}</p>}
      <Button variant="outline" disabled={busy || !key.trim()} onClick={test}>Probar conexión</Button>
      <Button disabled={busy || !canSaveConnection(draft, verified)} className="w-full" onClick={save}>Guardar Tavily</Button>
    </div>
  );
}
