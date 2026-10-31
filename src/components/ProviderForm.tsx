import { useRef, useState } from "react";
import { LoaderCircle, Plug, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/components/AppShell";
import { getRepo } from "@/lib/app-db";
import { useMutate } from "@/lib/use-app";
import type { Provider, ProviderKind } from "@/lib/db/repo";
import { canSaveModel, PROVIDER_KINDS, testProvider, type ConnectionResult, type ProviderCall } from "@/lib/providers";

export function ConnectionDiagnostic({ result }: { result: ConnectionResult | null }) {
  if (!result) return null;
  return <div role="status" className={`break-words rounded-md border p-3 text-sm ${result.ok ? "text-primary" : "text-destructive"}`}>
    <p>{result.ok ? "Conexión exitosa. El modelo respondió correctamente." : result.message}</p>
    {!result.ok && result.httpStatus !== undefined && <p className="mt-1">HTTP {result.httpStatus}</p>}
    {!result.ok && result.technical && <details className="mt-2"><summary>Detalle técnico</summary><pre className="mt-1 whitespace-pre-wrap break-all text-xs">{result.technical}</pre></details>}
  </div>;
}

export function ProviderForm({ provider, onClose }: { provider?: Provider | undefined; onClose: () => void }) {
  const first = PROVIDER_KINDS[0];
  const [form, setForm] = useState({ name: provider?.name ?? first?.label ?? "", kind: provider?.kind ?? "openai" as ProviderKind, endpoint: provider?.endpoint ?? first?.endpoint ?? "", apiKey: "", model: provider?.model ?? first?.model ?? "", deployment: provider?.deployment ?? "", apiVersion: provider?.api_version ?? "", extraParams: provider?.extra_params ?? "" });
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [tested, setTested] = useState<ProviderCall | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const epoch = useRef(0);
  const mutate = useMutate();
  const azureOpenAI = form.kind === "azure_openai";
  const call: ProviderCall = { kind: form.kind, endpoint: form.endpoint, apiKey: form.apiKey, model: azureOpenAI ? form.deployment.trim() : form.model, deployment: form.deployment, apiVersion: form.apiVersion, extraParams: azureOpenAI ? "" : form.extraParams };
  function change(patch: Partial<typeof form>) { epoch.current++; setForm({ ...form, ...patch }); setResult(null); setTested(null); }
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
      await mutate(async r => { const id = await r.saveProvider({ ...form, ...(azureOpenAI ? { name: `Azure OpenAI · ${form.deployment.trim()}`, model: call.model, extraParams: "" } : {}), apiKey: form.apiKey || undefined }, provider?.id); await r.setProviderVerification(id, "verified"); });
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
    <Button variant="outline" className="w-full" disabled={busy || saving} onClick={test}>{busy ? <LoaderCircle className="animate-spin" /> : <Plug />}{busy ? "Conectando..." : "Probar conexión"}</Button>
    <ConnectionDiagnostic result={result} />
    <div className="flex flex-wrap gap-2"><Button className="flex-1" disabled={busy || saving || !form.name.trim() || !canSaveModel(call, tested, result)} onClick={save}><Save />Guardar modelo</Button><Button variant="ghost" disabled={saving} onClick={() => { epoch.current++; onClose(); }}>Cancelar</Button></div>
  </section>;
}