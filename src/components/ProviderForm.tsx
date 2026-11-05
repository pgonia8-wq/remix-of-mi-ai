import { useRef, useState } from "react";
import { LoaderCircle, Plug, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/components/AppShell";
import { getRepo } from "@/lib/app-db";
import { useMutate } from "@/lib/use-app";
import type { Provider, ProviderKind } from "@/lib/db/repo";
import { canSaveModel, PROVIDER_KINDS, testProvider, type ConnectionResult, type ProviderCall } from "@/lib/providers";
import { AZURE_KIND_LABEL, azureDeploymentKind, azureKindOf, azureKindParams, looksLikeCosmosEndpoint, parseAzureUrl, type AzureDeploymentKind } from "@/lib/azure-url";
import { useCoreQuery } from "@/lib/use-app";
import { AzureVideoModelForm } from "@/components/AzureVideoModelForm";

// "video" = Azure Sora: verified by a real (billed, asynchronous) clip in its own form, not by "Probar conexión".
type FormKind = AzureDeploymentKind | "video";
const AZURE_KIND_OPTIONS: [FormKind, string][] = [["chat", "Chat de texto"], ["tts", "Texto a voz"], ["audio-chat", "Audio (gpt-audio)"], ["realtime", "Voz en tiempo real"], ["transcribe", "Transcripción"], ["embedding", "Embeddings"], ["image", "Imágenes"], ["video", "Video (Sora)"], ["cosmos", "Video e imágenes (NVIDIA Cosmos)"]];

export function ConnectionDiagnostic({ result }: { result: ConnectionResult | null }) {
  if (!result) return null;
  return <div role="status" className={`break-words rounded-md border p-3 text-sm ${result.ok ? "text-primary" : "text-destructive"}`}>
    <p>{result.ok ? "Conexión exitosa. El modelo respondió correctamente." : result.message}</p>
    {!result.ok && result.httpStatus !== undefined && <p className="mt-1">HTTP {result.httpStatus}</p>}
    {!result.ok && result.technical && <details className="mt-2"><summary>Detalle técnico</summary><pre className="mt-1 whitespace-pre-wrap break-all text-xs">{result.technical}</pre></details>}
  </div>;
}

export function ProviderForm({ provider, onClose }: { provider?: Provider | undefined; onClose: () => void }) {
  const first = PROVIDER_KINDS.find(p => p.kind === "azure_openai");
  const [formKind, setFormKind] = useState<FormKind>(() => azureKindOf({ deployment: provider?.deployment ?? "", extraParams: provider?.extra_params ?? "" }));
  const kindTouched = useRef(!!provider);
  const [form, setForm] = useState({ name: provider?.name ?? first?.label ?? "", kind: provider?.kind ?? "azure_openai" as ProviderKind, endpoint: provider?.endpoint ?? first?.endpoint ?? "", apiKey: "", model: provider?.model ?? first?.model ?? "", deployment: provider?.deployment ?? "", apiVersion: provider?.api_version ?? "", extraParams: provider?.extra_params ?? "" });
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [tested, setTested] = useState<ProviderCall | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const epoch = useRef(0);
  const mutate = useMutate();
  const { data: azureProviders = [] } = useCoreQuery(["providers-azure"], async (c) => (await c.repo.registry.listProviders()).filter((p) => p.adapter === "azure_openai"));
  const azureKind: AzureDeploymentKind = formKind === "video" ? "chat" : formKind;
  const sora = form.kind === "azure_openai" && formKind === "video";
  const azureOpenAI = form.kind === "azure_openai";
  const call: ProviderCall = { kind: form.kind, endpoint: form.endpoint, apiKey: form.apiKey, model: azureOpenAI ? form.deployment.trim() : form.model, deployment: form.deployment, apiVersion: form.apiVersion, extraParams: azureOpenAI ? azureKindParams(azureKind) : form.extraParams };
  function change(patch: Partial<typeof form>) {
    // Any Azure portal URL (…/openai/v1/responses, …/deployments/<x>/audio/speech?api-version=…, wss realtime)
    // → resource or /openai/v1 URL, plus the deployment, API version and model type it names.
    let op: Parameters<typeof azureDeploymentKind>[1];
    if (azureOpenAI && patch.endpoint !== undefined && looksLikeCosmosEndpoint(patch.endpoint)) {
      // Foundry "Target URI" of a managed-compute deployment → NVIDIA Cosmos.
      kindTouched.current = true; setFormKind("cosmos");
    } else if (azureOpenAI && patch.endpoint !== undefined) {
      const a = parseAzureUrl(patch.endpoint);
      if (a && (a.endpoint !== patch.endpoint.trim().replace(/\/+$/, "") || a.deployment || a.apiVersion)) {
        op = a.op;
        patch = { ...patch, endpoint: a.endpoint, ...(a.deployment ? { deployment: a.deployment } : {}), ...(a.apiVersion ? { apiVersion: a.apiVersion } : {}) };
      }
    }
    if (azureOpenAI && (op || (patch.deployment !== undefined && !kindTouched.current))) {
      const name = patch.deployment ?? form.deployment;
      const k: FormKind = op === "videos" || /sora/i.test(name) ? "video" : azureDeploymentKind(name, op);
      if (op || k !== "chat" || !kindTouched.current) setFormKind(k);
    }
    epoch.current++; setForm({ ...form, ...patch }); setResult(null); setTested(null);
  }
  const kindNote = sora ? "" : azureOpenAI ? AZURE_KIND_LABEL[azureKind] : "";
  async function test() {
    const version = ++epoch.current;
    const snapshot = { ...call };
    setBusy(true); setResult(null); setTested(null);
    try {
      const key = snapshot.apiKey || (provider ? await (await getRepo()).getProviderSecret(provider.id) : null);
      const outcome = await testProvider({ ...snapshot, apiKey: key });
      if (epoch.current === version) { setResult(outcome); setTested(snapshot); }
    } catch { if (epoch.current === version) setResult({ ok: false, code: "auth", message: "No se pudo recuperar la credencial protegida. Vuelve a introducirla." }); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!canSaveModel(call, tested, result) || !form.name.trim()) return;
    setSaving(true);
    try {
      await mutate(async r => { const id = await r.saveProvider({ ...form, ...(azureOpenAI ? { name: `${azureKind === "cosmos" ? "NVIDIA Cosmos" : "Azure OpenAI"} · ${form.deployment.trim()}`, model: call.model, extraParams: azureKindParams(azureKind) } : {}), apiKey: form.apiKey || undefined }, provider?.id); await r.setProviderVerification(id, "verified"); });
      onClose();
    } catch { setResult({ ok: false, code: "parameters", message: "No se pudo guardar el modelo en el almacenamiento local." }); }
    finally { setSaving(false); }
  }
  const meta = PROVIDER_KINDS.find(x => x.kind === form.kind);
  const field = (label: string, key: "name" | "endpoint" | "apiKey" | "model" | "deployment" | "apiVersion") => <label className="block space-y-1 text-sm">{label}<input className={inputCls} aria-label={label} type={key === "apiKey" ? "password" : "text"} autoComplete="off" disabled={saving} value={form[key]} onChange={e => change({ [key]: e.target.value })} /></label>;
  return <section className="space-y-3 rounded-md border bg-card p-3">
    <label className="block space-y-1 text-sm">Proveedor<select aria-label="Proveedor" className={inputCls} value={form.kind} disabled={!!provider || saving} onChange={e => { const defaults = PROVIDER_KINDS.find(x => x.kind === e.target.value); if (defaults) change({ kind: defaults.kind, name: defaults.label, endpoint: defaults.endpoint, model: defaults.model, apiKey: "", deployment: "", apiVersion: "", extraParams: "" }); }}>{PROVIDER_KINDS.map(p => <option key={p.kind} value={p.kind}>{p.label}</option>)}</select></label>
    {!azureOpenAI && field("Nombre", "name")}{field(azureOpenAI ? "URL" : "Endpoint", "endpoint")}{field(provider?.has_key ? "API Key (vacío = conservar la actual)" : "API Key", "apiKey")}{!azureOpenAI && field("Modelo", "model")}{field(meta?.needsDeployment ? "Deployment" : "Deployment (opcional)", "deployment")}{field(azureOpenAI ? "Versión de API" : "Versión de API (opcional)", "apiVersion")}
    {!azureOpenAI && <label className="block space-y-1 text-sm">Parámetros extra JSON<textarea aria-label="Parámetros extra JSON" className={inputCls} disabled={saving} rows={2} value={form.extraParams} onChange={e => change({ extraParams: e.target.value })} /></label>}
    {azureOpenAI && <label className="block space-y-1 text-sm">Tipo de modelo<select aria-label="Tipo de modelo" className={inputCls} disabled={saving} value={formKind} onChange={e => { kindTouched.current = true; setFormKind(e.target.value as FormKind); epoch.current++; setResult(null); setTested(null); }}>{AZURE_KIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
    {kindNote && <p className="text-xs text-muted-foreground">{kindNote}</p>}
    {sora ? <>
      <p className="text-xs text-muted-foreground">Video (Sora): se verifica generando un clip real de 4 s en tu Azure (con costo) y el modelo se guarda solo si llega un MP4 real. Usa la conexión de Azure ya guardada de ese recurso.</p>
      {azureProviders.length ? <AzureVideoModelForm providers={azureProviders} initialModel={form.deployment.trim()} /> : <p className="text-xs text-destructive">Primero guarda otro modelo de ese mismo recurso de Azure (por ejemplo uno de chat) para que quede guardada la clave.</p>}
      <Button variant="ghost" className="w-full" onClick={() => { epoch.current++; onClose(); }}>Cerrar</Button>
    </> : <>
    <Button variant="outline" className="w-full" disabled={busy || saving} onClick={test}>{busy ? <LoaderCircle className="animate-spin" /> : <Plug />}{busy ? (azureKind === "cosmos" ? "Generando imagen de prueba (puede tardar 1–3 min)…" : "Conectando...") : "Probar conexión"}</Button>
    <ConnectionDiagnostic result={result} />
    <div className="flex flex-wrap gap-2"><Button className="flex-1" disabled={busy || saving || !form.name.trim() || !canSaveModel(call, tested, result)} onClick={save}><Save />Guardar modelo</Button><Button variant="ghost" disabled={saving} onClick={() => { epoch.current++; onClose(); }}>Cancelar</Button></div>
    </>}
  </section>;
}