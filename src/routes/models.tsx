import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, FlaskConical, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { getAdapter } from "@/lib/core/adapters";
import { credentialsFor, testOperation } from "@/lib/core/executor";
import type { ModelWithCaps } from "@/lib/core/registry";
import { inputCls } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

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
  const models = data?.models ?? [], providers = data?.providers ?? [], caps = data?.caps ?? [];

  async function importCatalog(providerId: string, adapterId: string) {
    const ad = getAdapter(adapterId);
    if (!ad.listModels) return toast.error(`${ad.label} no ofrece un catálogo oficial con tu API key; registra los modelos a mano.`);
    try {
      await mutate(async (c) => {
        const { creds } = await credentialsFor(c.repo, providerId);
        const ids = await ad.listModels!(creds);
        const r = await c.repo.registry.applyImport(providerId, ids);
        toast.success(`${r.added} modelos del catálogo oficial; ${r.retired} marcados como retirados. Asigna sus capacidades.`);
      });
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Modelos</h1>
        <Button size="sm" onClick={() => setAdding((v) => !v)}><Plus /> Registrar</Button>
      </div>
      <p className="text-xs text-muted-foreground">Cada modelo muestra solo las capacidades que tú o su catálogo declaran. «Probar» hace una operación real con tu clave (puede tener costo). Los proveedores de texto se agregan en Ajustes.</p>
      {adding && <RegisterModel providers={providers} caps={caps.map((c) => c.id)} onDone={() => setAdding(false)} />}

      <section className="space-y-2 rounded-xl border bg-card p-3 text-sm">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Proveedores</h2>
          <Button size="sm" variant="outline" onClick={() => setEleven((v) => !v)}><Plus /> ElevenLabs</Button></div>
        {eleven && <ElevenLabsForm onDone={() => setEleven(false)} />}
        {!providers.length && <p className="text-xs text-muted-foreground">Sin proveedores. Agrega uno en Ajustes.</p>}
        {providers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 border-t pt-2">
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{getAdapter(p.adapter).label} · {p.enabled ? "activo" : "desactivado"}</div></div>
            <Button size="sm" variant="ghost" onClick={() => importCatalog(p.id, p.adapter)}><Download /> Catálogo</Button>
          </div>
        ))}
      </section>

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
  const kind = m.provider_kind;
  return getAdapter(kind === "openai" ? "openai" : kind === "azure_openai" || kind === "azure" ? "azure_openai" : kind === "elevenlabs" ? "elevenlabs" : `text:${kind}`);
}

function RegisterModel({ providers, caps, onDone }: { providers: { id: string; name: string }[]; caps: string[]; onDone: () => void }) {
  const mutate = useCoreMutate();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [remote, setRemote] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [cost, setCost] = useState("");
  async function save() {
    if (!providerId || !remote.trim() || !sel.length) return toast.error("Elige proveedor, identificador oficial y al menos una capacidad.");
    await mutate(async (c) => {
      const id = await c.repo.registry.upsertModel({ providerId, remoteId: remote.trim(), source: "manual", costInfo: cost.trim() || null });
      await c.repo.registry.setModelCapabilities(id, sel);
    });
    toast.success("Modelo registrado. Pruébalo antes de confiar en él.");
    onDone();
  }
  return (
    <div className="space-y-2 rounded-xl border bg-card p-3 text-sm">
      <select className={inputCls} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
        {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input className={inputCls} placeholder="Identificador oficial o deployment (p. ej. gpt-image-1)" value={remote} onChange={(e) => setRemote(e.target.value)} />
      <input className={inputCls} placeholder="Costo conocido (opcional, p. ej. «$0.04 por imagen»)" value={cost} onChange={(e) => setCost(e.target.value)} />
      <div className="grid grid-cols-2 gap-1">
        {caps.map((c) => <label key={c} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={sel.includes(c)} onChange={(e) => setSel(e.target.checked ? [...sel, c] : sel.filter((x) => x !== c))} /><span className="font-mono">{c}</span></label>)}
      </div>
      <div className="flex gap-2"><Button className="flex-1" onClick={save}>Guardar</Button><Button variant="outline" onClick={onDone}>Cancelar</Button></div>
    </div>
  );
}

function ElevenLabsForm({ onDone }: { onDone: () => void }) {
  const mutate = useCoreMutate();
  const [key, setKey] = useState("");
  async function save() {
    if (!key.trim()) return toast.error("Introduce tu API key de ElevenLabs.");
    await mutate(async (c) => {
      const pid = await c.repo.saveProvider({ name: "ElevenLabs", kind: "elevenlabs", model: "eleven_multilingual_v2", apiKey: key.trim() });
      const mid = await c.repo.registry.upsertModel({ providerId: pid, remoteId: "eleven_multilingual_v2", source: "manual" });
      await c.repo.registry.setModelCapabilities(mid, ["audio.tts"]);
    });
    setKey("");
    toast.success("ElevenLabs guardado con la clave cifrada. Usa «Probar» en audio.tts.");
    onDone();
  }
  return (
    <div className="space-y-2">
      <input className={inputCls} type="password" autoComplete="off" placeholder="API key de ElevenLabs" value={key} onChange={(e) => setKey(e.target.value)} />
      <Button className="w-full" onClick={save}>Guardar ElevenLabs</Button>
    </div>
  );
}
