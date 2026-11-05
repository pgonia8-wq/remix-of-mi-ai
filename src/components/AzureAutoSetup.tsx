import { useState } from "react";
import { Check, LoaderCircle, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/components/AppShell";
import { AzureVideoModelForm } from "@/components/AzureVideoModelForm";
import { getRepo } from "@/lib/app-db";
import { useCoreQuery, useMutate } from "@/lib/use-app";
import { testProvider } from "@/lib/providers";
import { azureKindParams, type AzureDeploymentKind } from "@/lib/azure-url";
import { AUTO_KIND_LABEL, LEGACY_FALLBACK_VERSION, baseOf, cosmosRowFromUrl, discoverAzureDeployments, originOf, parseDeploymentLines, type AutoKind, type AutoRow } from "@/lib/azure-autosetup";

type Status = { state: "idle" | "testing" | "saved" | "error"; message?: string };
const KINDS = Object.keys(AUTO_KIND_LABEL) as AutoKind[];

/** One URL + one key → every Azure deployment detected, typed, really tested and saved with its right use. */
export function AzureAutoSetup() {
  const mutate = useMutate();
  const { data: azure = [] } = useCoreQuery(["providers-azure"], async (c) => (await c.repo.registry.listProviders()).filter((p) => p.adapter === "azure_openai"));
  const [url, setUrl] = useState(""), [key, setKey] = useState(""), [names, setNames] = useState("");
  const [rows, setRows] = useState<AutoRow[]>([]), [status, setStatus] = useState<Record<string, Status>>({});
  const [busy, setBusy] = useState<"" | "search" | "test">(""), [note, setNote] = useState("");
  const base = baseOf(url);

  /** Empty key field → reuse the key already saved for this same Azure resource (never shown). */
  async function resolveKey(): Promise<string> {
    if (key.trim()) return key.trim();
    if (!base) return "";
    const repo = await getRepo();
    for (const p of await repo.listProviders()) if (p.kind === "azure_openai" && p.has_key && baseOf(p.endpoint ?? "")?.origin === base.origin) { const k = await repo.getProviderSecret(p.id); if (k) return k; }
    return "";
  }

  async function search() {
    setBusy("search"); setNote("");
    try {
      // Target URI of a managed-compute deployment (NVIDIA Cosmos): one row, tested with its own key.
      const cosmos = cosmosRowFromUrl(url, names);
      if (cosmos) {
        setRows([cosmos]); setStatus({});
        setNote(key.trim() ? "Detecté un endpoint de NVIDIA Cosmos (video e imágenes). Toca «Probar y guardar todo»." : "Detecté un endpoint de NVIDIA Cosmos. Escribe la clave de ese deployment (aparece junto al URI de destino en Foundry) y toca «Probar y guardar todo».");
        return;
      }
      const k = await resolveKey();
      if (!base || !k) { setNote(!base ? "Pega la URL de tu recurso de Azure (cualquier URL que te muestre el portal sirve)." : "Escribe tu API Key."); return; }
      const found = await discoverAzureDeployments(url, k);
      const typed = parseDeploymentLines(names, url);
      const merged = new Map([...found, ...typed].map((r) => [r.deployment.toLowerCase(), r]));
      setRows([...merged.values()]); setStatus({});
      const cosmosHere = [...merged.values()].some((r) => r.kind === "cosmos");
      setNote(found.length ? `Encontré ${found.length} modelos en tu recurso y detecté para qué sirve cada uno.${cosmosHere ? " NVIDIA Cosmos quedó como «Video e imágenes»." : ""}` : typed.length ? "Tu recurso no permite listar sus modelos; usaré los nombres que escribiste." : "Tu recurso no permite listar sus modelos automáticamente. Escribe abajo los nombres de tus deployments (uno por línea) o pega sus URLs, y vuelve a tocar «Buscar».");
    } catch (e) { setNote(e instanceof Error ? e.message : "No se pudo consultar Azure."); }
    finally { setBusy(""); }
  }

  async function testAndSave() {
    const todo = rows.filter((r) => r.kind !== "video" && status[r.deployment]?.state !== "saved");
    if (!todo.length) return;
    if (!confirm(`Probaré ${todo.length} modelo(s) con una solicitud real corta cada uno (en imágenes se genera 1 imagen pequeña). Puede tener un costo mínimo. Solo se guardan los que respondan bien. ¿Continuar?`)) return;
    setBusy("test");
    const k = await resolveKey();
    if (!k) { setBusy(""); setNote("Escribe la API Key."); return; }
    let saved = 0;
    const repo = await getRepo();
    const existing = await repo.listProviders();
    for (const r of todo) {
      setStatus((s) => ({ ...s, [r.deployment]: { state: "testing" } }));
      const kind = r.kind as AzureDeploymentKind;
      const call = (endpoint: string, apiVersion: string) => ({ kind: "azure_openai" as const, endpoint, apiKey: k, model: r.deployment, deployment: r.deployment, apiVersion, extraParams: azureKindParams(kind) });
      let used = call(r.endpoint, r.apiVersion ?? "");
      let out = await testProvider(used, 30000);
      // Some deployments (older voice/transcription) only answer on the classic route with an API version.
      if (!out.ok && kind !== "cosmos" && r.endpoint.endsWith("/openai/v1") && (out.httpStatus === 404 || out.httpStatus === 400)) {
        const legacy = call(r.endpoint.replace(/\/openai\/v1$/, ""), LEGACY_FALLBACK_VERSION);
        const retry = await testProvider(legacy, 30000);
        if (retry.ok) { used = legacy; out = retry; }
      }
      if (!out.ok) { setStatus((s) => ({ ...s, [r.deployment]: { state: "error", message: out.message } })); continue; }
      const same = existing.find((p) => p.kind === "azure_openai" && (p.deployment ?? "").toLowerCase() === r.deployment.toLowerCase() && originOf(p.endpoint) === originOf(used.endpoint));
      try {
        await mutate(async (repo) => { const id = await repo.saveProvider({ name: kind === "cosmos" ? `NVIDIA Cosmos · ${r.deployment}` : `Azure OpenAI · ${r.deployment}`, kind: "azure_openai", endpoint: used.endpoint, apiKey: k, model: r.deployment, deployment: r.deployment, apiVersion: used.apiVersion, extraParams: used.extraParams }, same?.id); await repo.setProviderVerification(id, "verified"); });
        saved++;
        setStatus((s) => ({ ...s, [r.deployment]: { state: "saved" } }));
      } catch { setStatus((s) => ({ ...s, [r.deployment]: { state: "error", message: "No se pudo guardar en el teléfono." } })); }
    }
    setBusy(""); setKey("");
    toast[saved ? "success" : "error"](saved ? `${saved} modelo(s) listos y guardados. Ya puedes usarlos en el chat y las herramientas.` : "Ningún modelo respondió. Revisa los mensajes de cada uno.");
  }

  const videos = rows.filter((r) => r.kind === "video");
  return <section className="space-y-3 rounded-xl border bg-card p-3 text-sm">
    <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">Configuración automática de Azure</h2></div>
    <p className="text-xs text-muted-foreground">Pega la URL de tu recurso y tu API Key. MI AI busca todos tus modelos (chat, imágenes, voz, transcripción, video…), detecta para qué sirve cada uno, los prueba y los deja listos. Para NVIDIA Cosmos pega su «URI de destino» y su clave.</p>
    <input className={inputCls} aria-label="URL de Azure" placeholder="https://tu-recurso.openai.azure.com (cualquier URL del portal)" value={url} onChange={(e) => setUrl(e.target.value)} />
    <input className={inputCls} aria-label="API Key de Azure" type="password" autoComplete="off" placeholder={azure.length ? "API Key (vacío = usar la ya guardada)" : "API Key"} value={key} onChange={(e) => setKey(e.target.value)} />
    <details><summary className="cursor-pointer text-xs text-primary">¿No los encuentra? Escribe tus deployments</summary>
      <textarea className={inputCls + " mt-2"} rows={3} aria-label="Deployments" placeholder={"gpt-5-chat\ngpt-image-1\ngpt-4o-mini-tts\nsora-2"} value={names} onChange={(e) => setNames(e.target.value)} />
    </details>
    <Button className="w-full" disabled={!!busy || !url.trim()} onClick={search}>{busy === "search" ? <LoaderCircle className="animate-spin" /> : <Search />}Buscar mis modelos</Button>
    {note && <p role="status" className="text-xs">{note}</p>}
    {rows.length > 0 && <ul className="space-y-1">{rows.map((r) => { const st = status[r.deployment]; return <li key={r.deployment} className="space-y-1 rounded-md bg-secondary/50 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{r.deployment}{r.model && r.model !== r.deployment ? <span className="font-normal text-muted-foreground"> · {r.model}</span> : null}</span>
        <select aria-label={`Uso de ${r.deployment}`} className="rounded-md border bg-background px-1 py-0.5 text-xs" disabled={!!busy || st?.state === "saved"} value={r.kind} onChange={(e) => { const kind = e.target.value as AutoKind; setRows((rs) => rs.map((x) => x.deployment === r.deployment ? { ...x, kind } : x)); setStatus((s) => ({ ...s, [r.deployment]: { state: "idle" } })); }}>{KINDS.map((k) => <option key={k} value={k}>{AUTO_KIND_LABEL[k]}</option>)}</select>
        {st?.state === "testing" && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {st?.state === "saved" && <Check className="h-4 w-4 text-primary" aria-label="Listo" />}
        {st?.state === "error" && <X className="h-4 w-4 text-destructive" aria-label="Falló" />}
      </div>
      {st?.state === "error" && <p className="break-words text-xs text-destructive">{st.message}</p>}
      {r.kind === "video" && <p className="text-xs text-muted-foreground">Video: su prueba genera un clip real de 4 s (con costo); se hace aparte, abajo.</p>}
      {r.kind === "cosmos" && <p className="text-xs text-muted-foreground">NVIDIA Cosmos: se prueba generando una imagen pequeña real y queda listo para crear videos e imágenes.</p>}
    </li>; })}</ul>}
    {rows.some((r) => r.kind !== "video") && <Button className="w-full" variant="outline" disabled={!!busy} onClick={testAndSave}>{busy === "test" ? <LoaderCircle className="animate-spin" /> : <Check />}{busy === "test" ? "Probando…" : "Probar y guardar todo"}</Button>}
    {videos.length > 0 && (azure.length
      ? videos.map((v) => <AzureVideoModelForm key={v.deployment} providers={azure} initialModel={v.deployment} />)
      : <p className="text-xs text-muted-foreground">Para probar el video primero guarda al menos otro modelo de este recurso (así queda guardada tu clave).</p>)}
  </section>;
}
