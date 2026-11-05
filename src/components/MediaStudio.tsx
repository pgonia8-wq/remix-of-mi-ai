import { useEffect, useRef, useState } from "react";
import { blobChunks } from "@/lib/device";
import { Link } from "@tanstack/react-router";
import { Play, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { NeedProject, inputCls } from "./AppShell";
import { Button } from "./ui/button";
import { Model3DViewer } from "./Model3DViewer";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { route, compatible as isCompatible } from "@/lib/core/router";
import { execute } from "@/lib/core/executor";
import { pollRemoteJob } from "@/lib/core/remote-jobs";
import type { Asset } from "@/lib/core/asset-store";
import { getCore } from "@/lib/core";
import { saveExport } from "@/lib/save-export";
import { JOB_DONE_EVENT, type JobDoneDetail } from "@/lib/use-remote-jobs";

export type StudioKind = "music" | "video" | "model3d";
const OPTIONS = {
  music: [{ id: "music.generate", label: "Música" }, { id: "audio.sfx", label: "Efecto sonoro" }],
  video: [{ id: "video.generate", label: "Generar video" }, { id: "video.edit", label: "Video a video" }],
  model3d: [{ id: "model3d.generate", label: "Modelo 3D" }],
};
export function MediaStudio({ kind }: { kind: StudioKind }) {
  const pid = useActiveProjectId(); return pid ? <Studio key={`${pid}:${kind}`} pid={pid} kind={kind} /> : <NeedProject />;
}
function Studio({ pid, kind }: { pid: string; kind: StudioKind }) {
  const { data: models = [] } = useCoreQuery(["media-models", pid], (c) => c.repo.registry.listModels());
  const { data: assets = [] } = useCoreQuery(["media-assets", pid, kind], async (c) => (await c.assets.list(pid)).filter((a) => kind === "music" ? ["music.generate", "audio.sfx"].includes(a.capability_id ?? "") : a.kind === kind));
  const { data: jobs = [] } = useCoreQuery(["media-jobs", pid, kind], async (c) => (await c.jobs.list(pid)).filter((j) => OPTIONS[kind].some((o) => o.id === j.capability_id)));
  const mutate = useCoreMutate(), upload = useRef<HTMLInputElement | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);
  const [capability, setCapability] = useState(OPTIONS[kind][0]?.id ?? ""), [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(""), [seconds, setSeconds] = useState(kind === "music" ? 30 : 4), [instrumental, setInstrumental] = useState(true);
  const [ratio, setRatio] = useState("1280:720"), [license, setLicense] = useState(""), [busy, setBusy] = useState(false), [file, setFile] = useState<File | null>(null), [open, setOpen] = useState<Asset | null>(null);
  const compatible = models.filter((m) => isCompatible(m, { capability, mode: "auto" }));
  async function act(fn: Parameters<typeof mutate>[0]) { setBusy(true); try { await mutate(fn); } catch (e) { toast.error(e instanceof Error ? e.message : "Operación no confirmada."); } finally { setBusy(false); } }
  const result = useRef<HTMLDivElement | null>(null);
  /** Opens a finished file right away so it plays here without searching for it. */
  async function showAsset(core: Awaited<ReturnType<typeof getCore>>, assetId: string | undefined) {
    if (!assetId) return;
    const a = (await core.assets.list(pid)).find((x) => x.id === assetId);
    if (a) { setOpen(a); setTimeout(() => result.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300); }
  }
  // Slow jobs are checked app-wide (useRemoteJobWatcher); here the finished file opens right away.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<JobDoneDetail>).detail;
      if (d.projectId !== pid || !OPTIONS[kind].some((o) => o.id === d.capability)) return;
      void getCore().then((core) => showAsset(core, d.assetIds[0]));
    };
    window.addEventListener(JOB_DONE_EVENT, on);
    return () => window.removeEventListener(JOB_DONE_EVENT, on);
  }, [pid, kind]);
  async function generate() {
    if (!confirm("¿Enviar al proveedor con tu clave? Puede tener costo. La licencia depende del proveedor y de tu plan.")) return;
    await act(async (core) => {
      const decision = route(compatible, { capability, mode: modelId ? "manual" : "auto", manualModelId: modelId || null });
      if (!decision.ok) throw new Error(decision.reason);
      const files = file ? [{ bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, name: file.name }] : undefined;
      const result = await execute(core, pid, decision.model, { capability, prompt, params: { seconds, instrumental, ratio, license: license.trim() || "No verificada; revisar términos del proveedor", ...(open ? { parentAssetId: open.id } : {}) }, ...(files ? { files } : {}), parentAssetId: open?.id ?? null });
      if (result.pending) toast.success(kind === "video" ? "Video en proceso. Tarda unos minutos: MI AI lo revisa solo y lo abre aquí abajo cuando esté listo." : "Trabajo enviado. Se revisa solo y aparecerá abajo.");
      else { toast.success(kind === "video" ? "Video listo: se reproduce abajo." : "Listo: se abre abajo."); await showAsset(core, result.assets[0]?.id); }
    });
  }
  return <div className="space-y-4 p-4">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">{kind === "music" ? "Música y sonido" : kind === "video" ? "Video" : "Modelos 3D"}</h1><Link to="/models" className="text-sm text-primary underline">Modelos</Link></div>
    <div className="flex flex-wrap gap-2">{OPTIONS[kind].map((o) => <Button key={o.id} size="sm" variant={capability === o.id ? "default" : "outline"} onClick={() => { setCapability(o.id); setModelId(""); }}>{o.label}</Button>)}</div>
    <select aria-label="Modelo de medios" className={inputCls} value={modelId} onChange={(e) => setModelId(e.target.value)}><option value="">Automático</option>{compatible.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.provider_name}</option>)}</select>
    {!compatible.length && <p className="text-sm text-muted-foreground">Sin modelo compatible configurado para esta operación.</p>}
    <textarea aria-label="Descripción de medios" className={inputCls} rows={4} maxLength={kind === "model3d" ? 800 : 1000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={kind === "model3d" ? "Describe el objeto" : kind === "music" ? "Género, ambiente, instrumentos y letra" : "Escena, movimiento y composición"} />
    {kind !== "model3d" && <label className="block text-sm">Duración (segundos)<input aria-label="Duración de medios" type="number" min={kind === "music" ? capability === "audio.sfx" ? 0.5 : 3 : 2} max={kind === "music" ? capability === "audio.sfx" ? 30 : 600 : 12} className={inputCls} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /></label>}
    {kind === "music" && capability === "music.generate" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} />Instrumental</label>}
    {kind === "video" && <select aria-label="Orientación del video" className={inputCls} value={ratio} onChange={(e) => setRatio(e.target.value)}><option value="1280:720">Horizontal</option><option value="720:1280">Vertical</option></select>}
    {kind !== "music" && <><input ref={upload} type="file" aria-label="Referencia de medios" accept={capability === "video.edit" ? "video/mp4" : "image/png,image/jpeg,image/webp"} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size > 20_000_000) { toast.error("La referencia supera 20 MB."); return; } setFile(f ?? null); }} /><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => upload.current?.click()}><Upload />Referencia</Button>{file && <Button variant="ghost" onClick={() => setFile(null)}>{file.name} · Quitar</Button>}</div></>}
    <input aria-label="Licencia de medios" className={inputCls} value={license} onChange={(e) => setLicense(e.target.value)} placeholder="Licencia o términos comprobados (opcional)" />
    <p className="text-xs text-muted-foreground">Uso comercial no verificado. Revisa la licencia del proveedor y de tu plan.</p>
    {open && <p className="text-xs">Nueva versión de {open.name}</p>}
    <Button disabled={busy || !compatible.length || !prompt.trim()} onClick={generate}><Play />{busy ? "Procesando…" : "Generar"}</Button>
    {jobs.filter((j) => !!j.remote_id && ["processing", "interrupted", "recovery_required"].includes(j.status)).map((j) => <div key={j.id} className="flex items-center gap-2 border-b py-2 text-xs"><span className="min-w-0 flex-1">{j.capability_id === "video.generate" ? "Video" : j.capability_id} · {j.status === "processing" ? "generándose (se revisa solo cada 20 s)" : j.status}{j.progress !== null ? ` · ${Math.round(j.progress * 100)} %` : ""}</span><Button variant="outline" size="sm" disabled={busy} onClick={() => act(async (core) => { const r = await pollRemoteJob(core, pid, j.id); toast.success(r.pending ? "Sigue procesando" : "Listo: se abre abajo."); if (!r.pending) await showAsset(core, r.assets[0]?.id); })}><RefreshCw />Consultar</Button></div>)}
    {jobs.filter((j) => j.status === "failed" && Date.now() - j.updated_at < 3 * 86_400_000).slice(0, 3).map((j) => <p key={j.id} className="rounded-lg border border-destructive/40 p-2 text-xs text-destructive">{j.capability_id?.startsWith("video") ? "Un video no se pudo crear" : "Un trabajo falló"}: {j.error ?? "el proveedor lo rechazó"}</p>)}
    <div className="space-y-2 border-t pt-3"><div className="flex items-center justify-between"><h2 className="font-semibold">{kind === "video" ? "Tus videos (toca uno para verlo)" : "Biblioteca"}</h2><Button variant="outline" size="sm" onClick={() => importInput.current?.click()}><Upload />Importar</Button></div>
      <input ref={importInput} type="file" aria-label="Importar archivo de medios" className="hidden" accept={kind === "model3d" ? ".glb" : kind === "music" ? "audio/*" : "video/mp4"} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; act(async (core) => {
        if (f.size > (kind === "model3d" ? 200 : 2048) * 1024 * 1024) throw new Error(kind === "model3d" ? "Máximo 200 MB para modelos 3D." : "Máximo 2 GB por archivo.");
        if (kind === "model3d" && new TextDecoder().decode(new Uint8Array(await f.slice(0, 4).arrayBuffer())) !== "glTF") throw new Error("El archivo no es GLB.");
        const asset = await core.assets.put(pid, blobChunks(f), { kind: kind === "music" ? "audio" : kind, mime: kind === "model3d" ? "model/gltf-binary" : f.type || "video/mp4", name: f.name, capability: kind === "music" ? "music.generate" : null, params: { license: license.trim() || "Licencia del archivo importado no verificada", source: "import" } });
        setOpen(asset);
      }); e.target.value = ""; }} />
      {!assets.length && <p className="text-xs text-muted-foreground">Aún no hay archivos. Lo que generes aparece aquí y también en Biblioteca.</p>}
      {assets.map((a) => <Button variant={open?.id === a.id ? "default" : "outline"} key={a.id} className="w-full justify-start truncate" onClick={() => { setOpen(a); setTimeout(() => result.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}><Play />{a.name} · v{a.version}</Button>)}
    </div>
    <div ref={result}>{open && <MediaPreview asset={open} onClose={() => setOpen(null)} />}</div>
  </div>;
}
function MediaPreview({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null), [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    let live = true, objectUrl = "";
    getCore().then((c) => c.assets.read(asset.project_id, asset.id)).then((b) => { if (!live) return; setBytes(b); objectUrl = URL.createObjectURL(new Blob([b as BlobPart], { type: asset.mime })); setUrl(objectUrl); }).catch(() => live && setError("No se pudo leer el archivo cifrado."));
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset.id]);
  return <section className="space-y-3 border-t pt-3"><div className="flex items-center justify-between"><h2 className="min-w-0 break-words font-semibold">{asset.name}</h2><Button variant="ghost" onClick={onClose}>Cerrar</Button></div>
    {error && <p className="text-destructive">{error}</p>}
    {url && asset.kind === "audio" && <audio controls src={url} className="w-full" />}
    {url && asset.kind === "video" && <video controls playsInline autoPlay muted src={url} className="max-h-[70dvh] w-full rounded-lg bg-muted" />}
    {bytes && asset.kind === "model3d" && <Model3DViewer bytes={bytes} name={asset.name ?? "modelo"} />}
    <p className="text-xs text-muted-foreground">{asset.params ? String((JSON.parse(asset.params) as Record<string, unknown>)["license"] ?? "Licencia no verificada") : "Licencia no verificada"}</p>
    <Button variant="outline" disabled={!bytes} onClick={() => { if (bytes && confirm("¿Exportar una copia sin cifrar?")) saveExport(bytes, asset.name ?? "resultado", asset.mime).catch(() => toast.error("No se pudo exportar.")); }}>Exportar</Button>
  </section>;
}