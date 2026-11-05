import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Film, Play, RefreshCw, Share2, ShieldCheck, Sparkles, Tag, Trash2, Upload, Wand2, X } from "lucide-react";
import { saveExport } from "@/lib/save-export";
import { blobChunks, shareContent } from "@/lib/device";
import { VISION_MIME } from "@/lib/core/adapters/vision";
import { applyOp, describeOp, extFor, type ImageOp } from "@/lib/core/image-tools";
import { toast } from "sonner";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { route, type RouteMode } from "@/lib/core/router";
import { execute } from "@/lib/core/executor";
import { pollRemoteJob } from "@/lib/core/remote-jobs";
import type { Asset } from "@/lib/core/asset-store";
import { NeedProject, inputCls } from "@/components/AppShell";
import { AudioStudio } from "@/components/AudioStudio";
import { Button } from "@/components/ui/button";
import { MaskPainter } from "@/components/MaskPainter";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Biblioteca — MI AI" },
      { name: "description", content: "Imágenes, audio y archivos generados por IA, cifrados y organizados por proyecto." },
      { property: "og:title", content: "Biblioteca — MI AI" },
      { property: "og:description", content: "Tu contenido generado, cifrado en tu teléfono y organizado por proyecto." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Library,
});

const CREATE_CAPS = [
  { id: "image.generate", label: "Imagen" },
  { id: "video.generate", label: "Video" },
  { id: "vision", label: "Analizar" },
  { id: "audio.tts", label: "Voz" },
  { id: "audio.transcribe", label: "Transcribir" },
  { id: "audio.voice_clone", label: "Clonar" },
];

function Library() {
  const pid = useActiveProjectId();
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [open, setOpen] = useState<Asset | null>(null);
  const [batch, setBatch] = useState(false);
  const { data: assets = [] } = useCoreQuery(["assets", pid, kind, search, tag], (c) => c.assets.list(pid!, { ...(kind ? { kind } : {}), ...(search ? { search } : {}), ...(tag ? { tag } : {}) }), !!pid);
  const { data: tags = [] } = useCoreQuery(["tags", pid], (c) => c.assets.tags(pid!), !!pid);
  const mutate = useCoreMutate();
  if (!pid) return <NeedProject />;
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2"><h1 className="flex-1 text-2xl font-bold">Biblioteca</h1>
        <label className="flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-xs"><Upload className="h-3.5 w-3.5" /> Subir
          <input type="file" accept="image/*,audio/*,video/mp4,video/webm" multiple className="hidden" onChange={(e) => importFiles(pid, Array.from(e.target.files ?? []), mutate)} /></label>
        <Link to="/jobs" className="text-xs text-primary underline">Trabajos</Link></div>
      <Create projectId={pid} />
      <VideoJobs projectId={pid} />
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Buscar por nombre o prompt" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={inputCls + " w-28"} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Todo</option><option value="image">Imágenes</option><option value="audio">Audio</option><option value="video">Video</option><option value="document">Documentos</option><option value="text">Análisis</option>
        </select>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">{["", ...tags].map((t) => <button key={t} onClick={() => setTag(t)} className={`rounded-full border px-2 py-0.5 text-xs ${tag === t ? "border-primary bg-primary text-primary-foreground" : ""}`}>{t || "todas"}</button>)}</div>
      )}
      {batch ? <BatchTools images={assets.filter((a) => a.kind === "image")} onDone={() => setBatch(false)} /> : <button className="text-xs text-primary underline" onClick={() => setBatch(true)}>Procesar varias imágenes a la vez</button>}
      <div className="grid grid-cols-2 gap-2">
        {assets.map((a) => <Thumb key={a.id} a={a} onOpen={() => setOpen(a)} />)}
      </div>
      {!assets.length && <p className="text-center text-sm text-muted-foreground">Aún no hay contenido en este proyecto.</p>}
      {open && <AssetDetail key={open.id} a={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}

const MAX_IMPORT = 100 * 1024 * 1024;
async function importFiles(projectId: string, files: File[], mutate: ReturnType<typeof useCoreMutate>) {
  let ok = 0;
  for (const f of files) {
    if (!/^(image|audio|video)\//.test(f.type)) { toast.error(`${f.name}: solo imágenes, audio o video.`); continue; }
    if (f.size > (f.type.startsWith("video/") ? 2048 * 1024 * 1024 : MAX_IMPORT)) { toast.error(`${f.name}: ${f.type.startsWith("video/") ? "supera 2 GB" : "supera 100 MB"}.`); continue; }
    try {
      await mutate(async (c) => c.assets.put(projectId, blobChunks(f), { kind: f.type.split("/")[0]!, mime: f.type, name: f.name }));
      ok++;
    } catch (e) { toast.error(`${f.name}: ${(e as Error).message}`); }
  }
  if (ok) toast.success(`${ok} archivo(s) guardado(s) cifrados`);
}

function useAssetUrl(a: Asset | null, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!a || !enabled) return;
    let u: string | null = null, live = true;
    getCore().then((c) => c.assets.read(a.project_id, a.id)).then((b) => { if (!live) return; u = URL.createObjectURL(new Blob([b as BlobPart], { type: a.mime })); setUrl(u); }).catch((e) => live && setErr((e as Error).message));
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [a?.id, enabled]);
  return { url, err };
}

async function downloadAsset(a: Asset) {
  try {
    const c = await getCore();
    await saveExport(c.assets.stream(a.project_id, a.id), a.name ?? `miai-${a.id.slice(0, 8)}.${a.format ?? "mp4"}`, a.mime);
  } catch (e) { toast.error((e as Error).message); }
}

function Thumb({ a, onOpen }: { a: Asset; onOpen: () => void }) {
  const { url, err } = useAssetUrl(a, a.kind === "image" || (a.kind === "video" && (a.size ?? 0) < 60 * 1024 * 1024));
  return (
    <div className="relative">
    {a.kind === "video" && <button type="button" aria-label={`Descargar ${a.name ?? "video"}`} onClick={() => void downloadAsset(a)} className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-background/80"><Download className="h-4 w-4" /></button>}
    <button onClick={onOpen} className="w-full overflow-hidden rounded-xl border bg-card text-left">
      <div className="flex aspect-square items-center justify-center bg-secondary/40">
        {a.kind === "image" && url ? <img src={url} alt={a.prompt ?? a.name ?? "imagen"} className="h-full w-full object-cover" /> : a.kind === "video" ? <span className="relative flex h-full w-full items-center justify-center">{url && <video src={`${url}#t=0.5`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />}<span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-background/70"><Play className="h-5 w-5" /></span></span> : <span className="text-xs text-muted-foreground">{err ? "Archivo dañado" : a.kind === "audio" ? "Audio" : a.kind}</span>}
      </div>
      <div className="truncate p-2 text-xs">{a.name ?? a.prompt ?? a.id.slice(0, 8)} {a.version > 1 && `· v${a.version}`}</div>
    </button>
    </div>
  );
}

const TOOLS: ImageOp[] = [
  { op: "rotate", deg: 90 }, { op: "flip", axis: "h" }, { op: "crop", aspect: "1:1" }, { op: "crop", aspect: "9:16" }, { op: "crop", aspect: "16:9" },
  { op: "resize", scale: 2 }, { op: "resize", scale: 0.5 }, { op: "convert", mime: "image/jpeg", quality: 0.85 }, { op: "convert", mime: "image/webp", quality: 0.85 }, { op: "convert", mime: "image/png" },
];

function AssetDetail({ a, onClose, onOpen }: { a: Asset; onClose: () => void; onOpen: (a: Asset) => void }) {
  const { url, err } = useAssetUrl(a);
  const mutate = useCoreMutate();
  const { data: tags = [] } = useCoreQuery(["tags", a.id], (c) => c.assets.tags(a.project_id, a.id));
  const [newTag, setNewTag] = useState("");
  const [edit, setEdit] = useState("");
  const [maskMode, setMaskMode] = useState(false);
  const [mask, setMask] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const { data: family = [] } = useCoreQuery(["versions", a.id], (c) => c.assets.versions(a.project_id, a.id));
  async function tool(o: ImageOp) {
    setBusy(true);
    try {
      const c = await getCore();
      const src = await c.assets.read(a.project_id, a.id);
      const out = await applyOp(src, a.mime, o);
      const base = (a.name ?? "imagen").replace(/\.[a-z0-9]+$/i, "");
      const n = await c.assets.put(a.project_id, (async function* () { yield out.bytes; })(), {
        kind: "image", mime: out.mime, name: `${base}.${extFor(out.mime)}`, capability: "image.local", prompt: describeOp(o), params: { ...o, width: out.width, height: out.height }, parentId: a.id,
      });
      toast.success(`${describeOp(o)}: ${out.width}×${out.height}, nueva versión v${n.version}`);
      await mutate(async () => undefined);
      onOpen(n);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [textBody, setTextBody] = useState<string | null>(null);
  useEffect(() => {
    if (a.kind !== "text") return;
    getCore().then((c) => c.assets.read(a.project_id, a.id)).then((b) => setTextBody(new TextDecoder().decode(b))).catch(() => setTextBody(null));
  }, [a.id]);

  async function analyze() {
    setBusy(true);
    try {
      const c = await getCore();
      const d = route(await c.repo.registry.listModels(), { capability: "vision", mode: "auto" });
      if (!d.ok) { toast.error(d.reason); return; }
      const bytes = await c.assets.read(a.project_id, a.id);
      const r = await execute(c, a.project_id, d.model, { capability: "vision", prompt: question.trim() || "Describe esta imagen con detalle.", files: [{ bytes, mime: a.mime, name: a.name ?? "imagen" }], parentAssetId: a.id, saveText: true });
      setAnalysis(r.text ?? "");
      await mutate(async () => undefined);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function exportFile() {
    try {
      const c = await getCore();
      const name = a.name ?? `miai-${a.id.slice(0, 8)}.${a.format ?? "bin"}`;
      await saveExport(c.assets.stream(a.project_id, a.id), name, a.mime); // authenticated before any byte leaves
    } catch (e) { toast.error((e as Error).message); }
  }
  async function shareFile() {
    try {
      const c = await getCore();
      const name = a.name ?? `miai-${a.id.slice(0, 8)}.${a.format ?? "bin"}`;
      const r = await shareContent({ file: { data: c.assets.stream(a.project_id, a.id), name, mime: a.mime }, title: name });
      if (r === "downloaded") toast("Este navegador no puede compartir archivos; se descargó.");
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) toast.error((e as Error).message); }
  }
  async function runEdit(capability = "image.edit") {
    if (capability === "image.edit" && !edit.trim()) return;
    setBusy(true);
    try {
      const c = await getCore();
      const d = route(await c.repo.registry.listModels(), { capability, mode: "auto" });
      if (!d.ok) { toast.error(d.reason); return; }
      const bytes = await c.assets.read(a.project_id, a.id);
      const r = await execute(c, a.project_id, d.model, { capability, ...(capability === "image.edit" ? { prompt: edit } : {}), files: [{ bytes, mime: a.mime, name: `entrada.${a.format ?? "png"}` }, ...(capability === "image.edit" && mask ? [{ bytes: mask, mime: "image/png", name: "mask.png" }] : [])], parentAssetId: a.id });
      toast.success(`Nueva versión con ${d.model.name}`);
      setEdit(""); setMask(null); setMaskMode(false);
      await mutate(async () => undefined);
      if (r.assets[0]) onOpen(r.assets[0]);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-background/95 p-4" role="dialog" aria-modal="true">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex items-center gap-2"><h2 className="flex-1 truncate font-semibold">{a.name ?? a.prompt ?? "Activo"}</h2><Button variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}><X /></Button></div>
        {err && <p className="rounded-md bg-destructive/15 p-2 text-sm text-destructive">No se entrega el archivo: {err}</p>}
        {url && a.kind === "image" && (maskMode ? <MaskPainter src={url} onMask={setMask} disabled={busy} /> : <img src={url} alt={a.prompt ?? "imagen"} className="w-full rounded-xl border" />)}
        {url && a.kind === "audio" && <audio controls src={url} className="w-full" />}
        {url && a.kind === "video" && <video controls src={url} className="w-full rounded-xl" />}
        {a.kind === "text" && <p className="whitespace-pre-wrap rounded-xl border bg-card p-3 text-sm">{textBody ?? "…"}</p>}
        <dl className="grid grid-cols-3 gap-1 text-xs">
          <dt className="text-muted-foreground">Tipo</dt><dd className="col-span-2">{a.mime} · {(a.size / 1024).toFixed(1)} KB</dd>
          <dt className="text-muted-foreground">Capacidad</dt><dd className="col-span-2 font-mono">{a.capability_id ?? "—"}</dd>
          <dt className="text-muted-foreground">Prompt</dt><dd className="col-span-2 break-words">{a.prompt ?? "—"}</dd>
          <dt className="text-muted-foreground">Versión</dt><dd className="col-span-2">v{a.version}{a.parent_id ? " (derivada)" : ""}</dd>
          <dt className="text-muted-foreground">Cifrado</dt><dd className="col-span-2">{a.enc_state === "encrypted" ? `AES-256-GCM · llave v${a.key_id}` : "Dañado"}</dd>
          <dt className="text-muted-foreground">Fecha</dt><dd className="col-span-2">{new Date(a.created_at).toLocaleString()}</dd>
        </dl>
        <div className="flex flex-wrap gap-1">{tags.map((t) => <button key={t} onClick={() => mutate((c) => c.assets.untag(a.project_id, a.id, t))} className="rounded-full border px-2 py-0.5 text-xs">#{t} ×</button>)}</div>
        <div className="flex gap-2"><input className={inputCls} placeholder="Nueva etiqueta" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
          <Button variant="outline" onClick={() => newTag.trim() && mutate((c) => c.assets.tag(a.project_id, a.id, newTag)).then(() => setNewTag(""))}><Tag /></Button></div>
        {family.length > 1 && (
          <div className="space-y-1"><p className="text-xs text-muted-foreground">Versiones</p>
            <div className="flex flex-wrap gap-1">{family.map((v) => <button key={v.id} onClick={() => v.id !== a.id && onOpen(v)} className={`rounded-full border px-2 py-0.5 text-xs ${v.id === a.id ? "border-primary bg-primary text-primary-foreground" : ""}`}>v{v.version} · {v.prompt?.slice(0, 18) ?? (v.parent_id ? "derivada" : "original")}</button>)}</div>
          </div>
        )}
        {a.kind === "image" && (
          <div className="space-y-1"><p className="text-xs text-muted-foreground">Con IA (usa el modelo que tenga la capacidad; puede tener costo)</p>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => runEdit("image.remove_bg")}><Wand2 /> Eliminar fondo</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => runEdit("image.upscale")}><Sparkles /> Mejorar resolución</Button>
            </div>
          </div>
        )}
        {a.kind === "image" && (
          <div className="space-y-1"><p className="text-xs text-muted-foreground">Herramientas en el teléfono (sin costo, sin internet)</p>
            <div className="flex flex-wrap gap-1">{TOOLS.map((o) => <Button key={JSON.stringify(o)} size="sm" variant="outline" disabled={busy} onClick={() => tool(o)}>{describeOp(o)}</Button>)}</div>
          </div>
        )}
        {a.kind === "image" && VISION_MIME.includes(a.mime) && (
          <div className="space-y-2">
            <div className="flex gap-2"><input className={inputCls} placeholder="Pregunta sobre la imagen (opcional)" value={question} onChange={(e) => setQuestion(e.target.value)} />
              <Button variant="outline" disabled={busy} onClick={analyze} aria-label="Analizar imagen"><Eye />{busy ? "…" : ""}</Button></div>
            {analysis !== null && <p className="whitespace-pre-wrap rounded-xl border bg-card p-3 text-sm">{analysis}</p>}
          </div>
        )}
        {a.kind === "image" && (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={maskMode} onChange={(e) => { setMaskMode(e.target.checked); setMask(null); }} />Cambiar solo una zona (pinta sobre la imagen)</label>
            {maskMode && <p className="text-[10px] text-muted-foreground">{mask ? "Zona marcada. Describe qué poner en ella." : "Pinta la zona que quieres cambiar."} Funciona con modelos de edición que aceptan máscara (por ejemplo GPT-image en OpenAI o Azure).</p>}
            <div className="flex gap-2"><input className={inputCls} placeholder={maskMode ? "Qué poner en la zona pintada" : "Editar con instrucciones (crea versión nueva)"} value={edit} onChange={(e) => setEdit(e.target.value)} />
              <Button disabled={busy || (maskMode && !mask)} onClick={() => runEdit()}><Wand2 />{busy ? "…" : ""}</Button></div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" onClick={exportFile}><Download /> {a.kind === "video" ? "Descargar video" : "Guardar como"}</Button>
          <Button variant="outline" onClick={shareFile}><Share2 /> Compartir en…</Button>
          <Button variant="outline" onClick={() => getCore().then((c) => c.assets.verify(a.project_id, a.id)).then(() => toast.success("Integridad verificada"), (e) => toast.error((e as Error).message))}><ShieldCheck /> Verificar</Button>
          <Button variant="outline" onClick={() => confirm("¿Eliminar este activo?") && mutate((c) => c.assets.remove(a.project_id, a.id)).then(onClose)}><Trash2 /> Borrar</Button>
        </div>
      </div>
    </div>
  );
}

function Create({ projectId }: { projectId: string }) {
  const [cap, setCap] = useState("image.generate");
  const [mode, setMode] = useState<RouteMode>("auto");
  const [manual, setManual] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [count, setCount] = useState(1);
  const [seconds, setSeconds] = useState(4);
  const [ratio, setRatio] = useState("1280:720");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const mutate = useCoreMutate();
  const { data: models = [] } = useCoreQuery(["models"], (c) => c.repo.registry.listModels());
  const decision = useMemo(() => route(models, { capability: cap, mode, manualModelId: manual || null }), [models, cap, mode, manual]);
  const compatible = models.filter((m) => m.capabilities.includes(cap) && m.status === "active" && m.provider_enabled);

  async function run() {
    if (!decision.ok) { toast.error(decision.reason); return; }
    if (cap === "vision" && !file) { toast.error("Elige una imagen para analizar."); return; }
    if (cap !== "vision" && !prompt.trim()) { toast.error("Escribe una descripción."); return; }
    setBusy(true);
    try {
      const c = await getCore();
      if (cap === "vision" && file) {
        if (!VISION_MIME.includes(file.type)) throw new Error("Formato no admitido: usa PNG, JPEG, WEBP o GIF.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        // The source image is stored encrypted first so the analysis stays linked to it.
        const src = await c.assets.put(projectId, (async function* () { yield bytes; })(), { kind: "image", mime: file.type, name: file.name, capability: null, prompt: null, params: null });
        const r = await execute(c, projectId, decision.model, { capability: "vision", prompt: prompt.trim() || "Describe esta imagen con detalle.", files: [{ bytes, mime: file.type, name: file.name }], parentAssetId: src.id, saveText: true });
        setAnswer(r.text ?? "");
        setFile(null);
        return;
      }
      const r = await execute(c, projectId, decision.model, { capability: cap, prompt, params: cap === "image.generate" ? { size, n: count } : cap === "video.generate" ? { seconds, ratio } : {} });
      if (r.pending) toast.success("Video en proceso. Tarda unos minutos; MI AI lo revisa solo y aparecerá aquí en Biblioteca.");
      else toast.success(`${r.assets.length} archivo(s) guardado(s) cifrados`);
      setPrompt("");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); await mutate(async () => undefined); }
  }

  return (
    <section className="space-y-2 rounded-xl border bg-card p-3 text-sm">
      <div className="flex flex-wrap gap-1">{CREATE_CAPS.map((c) => <button key={c.id} onClick={() => setCap(c.id)} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${cap === c.id ? "border-primary bg-primary text-primary-foreground" : ""}`}>{c.label}</button>)}</div>
      {cap.startsWith("audio.") ? <AudioStudio key={cap} projectId={projectId} cap={cap as "audio.tts"} /> : <>
      {cap === "vision" && (
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-xs">
          <Upload className="h-4 w-4" /> {file ? file.name : "Elegir imagen (PNG, JPEG, WEBP, GIF)"}
          <input type="file" accept={VISION_MIME.join(",")} className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setAnswer(null); }} />
        </label>
      )}
      <textarea className={inputCls} rows={3} placeholder={cap === "audio.tts" ? "Texto para convertir en voz" : cap === "vision" ? "¿Qué quieres saber de la imagen? (opcional)" : cap === "video.generate" ? "Describe el video" : "Describe la imagen"} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div className="flex gap-2">
        <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as RouteMode)}>
          <option value="auto">Automático</option><option value="favorite">Favoritos</option><option value="manual">Manual</option>
        </select>
        {mode === "manual" && <select className={inputCls} value={manual} onChange={(e) => setManual(e.target.value)}><option value="">Elige modelo</option>{compatible.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        {cap === "image.generate" && <select className={inputCls} value={size} onChange={(e) => setSize(e.target.value)}><option>1024x1024</option><option>1024x1536</option><option>1536x1024</option></select>}
        {cap === "video.generate" && <select aria-label="Orientación del video" className={inputCls} value={ratio} onChange={(e) => setRatio(e.target.value)}><option value="1280:720">Horizontal</option><option value="720:1280">Vertical</option></select>}
        {cap === "video.generate" && <select aria-label="Duración del video" className={inputCls + " w-20"} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>{[4, 8, 12].map((n) => <option key={n} value={n}>{n} s</option>)}</select>}
        {cap === "image.generate" && <select aria-label="Cantidad" className={inputCls + " w-16"} value={count} onChange={(e) => setCount(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select>}
      </div>
      <p className={`text-xs ${decision.ok ? "text-muted-foreground" : "text-destructive"}`}>
        {decision.ok ? <>Modelo: <b>{decision.model.name}</b> — {decision.reasons.join(" · ")}</> : <>{decision.reason} <Link to="/models" className="underline">Registrar un modelo</Link></>}
      </p>
      <Button className="w-full" disabled={busy || !decision.ok} onClick={run}><Sparkles />{busy ? "Procesando…" : cap === "vision" ? "Analizar" : "Generar"}</Button>
      {answer !== null && <p className="whitespace-pre-wrap rounded-lg border bg-background p-2 text-sm">{answer}</p>}
      </>}
    </section>
  );
}

function BatchTools({ images, onDone }: { images: Asset[]; onDone: () => void }) {
  const mutate = useCoreMutate();
  const [sel, setSel] = useState<string[]>([]);
  const [op, setOp] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);
  async function run() {
    const o = TOOLS[op]!; let ok = 0, fail = 0;
    const c = await getCore();
    for (const [i, id] of sel.entries()) {
      const a = images.find((x) => x.id === id); if (!a) continue;
      setProgress(`${i + 1} de ${sel.length}…`);
      try {
        const out = await applyOp(await c.assets.read(a.project_id, a.id), a.mime, o);
        const base = (a.name ?? "imagen").replace(/\.[a-z0-9]+$/i, "");
        await c.assets.put(a.project_id, (async function* () { yield out.bytes; })(), { kind: "image", mime: out.mime, name: `${base}.${extFor(out.mime)}`, capability: "image.local", prompt: describeOp(o), params: { ...o, width: out.width, height: out.height, batch: true }, parentId: a.id });
        ok++;
      } catch { fail++; }
    }
    setProgress(null); await mutate(async () => undefined);
    toast[fail ? "warning" : "success"](`${describeOp(o)}: ${ok} listas${fail ? `, ${fail} con error` : ""}. Los originales se conservan.`);
    onDone();
  }
  return (
    <section className="space-y-2 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2"><h2 className="flex-1 font-semibold">Procesar en lote</h2><Button size="sm" variant="ghost" onClick={onDone}>Cerrar</Button></div>
      <select aria-label="Operación en lote" className={inputCls} value={op} onChange={(e) => setOp(Number(e.target.value))}>{TOOLS.map((o, i) => <option key={i} value={i}>{describeOp(o)}</option>)}</select>
      <div className="flex gap-2 text-xs"><button className="underline" onClick={() => setSel(images.map((i) => i.id))}>Todas</button><button className="underline" onClick={() => setSel([])}>Ninguna</button><span className="text-muted-foreground">{sel.length} elegidas</span></div>
      <ul className="max-h-48 space-y-1 overflow-auto text-xs">{images.map((a) => <li key={a.id}><label className="flex items-center gap-2"><input type="checkbox" checked={sel.includes(a.id)} onChange={(e) => setSel(e.target.checked ? [...sel, a.id] : sel.filter((x) => x !== a.id))} />{a.name ?? a.id.slice(0, 8)}</label></li>)}</ul>
      <Button className="w-full" disabled={!sel.length || !!progress} onClick={run}>{progress ?? `Aplicar a ${sel.length}`}</Button>
      <p className="text-[10px] text-muted-foreground">Se hace en el teléfono, sin costo. Cada resultado es una versión nueva cifrada.</p>
    </section>
  );
}

/** Videos still being created (or that failed), so nothing disappears silently. */
function VideoJobs({ projectId }: { projectId: string }) {
  const mutate = useCoreMutate();
  const { data: jobs = [] } = useCoreQuery(["lib-video-jobs", projectId], async (c) => (await c.jobs.list(projectId)).filter((j) => j.capability_id?.startsWith("video.") && (["processing", "interrupted", "recovery_required"].includes(j.status) || (j.status === "failed" && Date.now() - j.updated_at < 3 * 86_400_000))));
  if (!jobs.length) return null;
  return (
    <section className="space-y-1 rounded-xl border bg-card p-3 text-xs">
      <h2 className="flex items-center gap-1 text-sm font-semibold"><Film className="h-4 w-4" /> Videos en camino</h2>
      {jobs.map((j) => (
        <div key={j.id} className="flex items-center gap-2 border-t py-1.5">
          <span className={`min-w-0 flex-1 ${j.status === "failed" ? "text-destructive" : ""}`}>
            {j.status === "failed" ? `No se pudo crear: ${j.error ?? "el proveedor lo rechazó"}` : j.status === "processing" ? `Generándose${j.progress !== null ? ` · ${Math.round(j.progress * 100)} %` : ""} (se revisa solo cada 20 s)` : `Pendiente de revisar: ${j.recovery ?? j.status}`}
          </span>
          {j.status !== "failed" && j.remote_id && <Button size="sm" variant="outline" onClick={() => mutate(async (c) => { const r = await pollRemoteJob(c, projectId, j.id); toast.success(r.pending ? "Sigue procesando." : "Video listo: ya está en Biblioteca."); }).catch((e) => toast.error((e as Error).message))}><RefreshCw /> Consultar</Button>}
        </div>
      ))}
    </section>
  );
}
