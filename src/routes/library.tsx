import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, ShieldCheck, Sparkles, Tag, Trash2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { route, type RouteMode } from "@/lib/core/router";
import { execute } from "@/lib/core/executor";
import type { Asset } from "@/lib/core/asset-store";
import { isNative } from "@/lib/app-db";
import { NeedProject, inputCls } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

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
  { id: "audio.tts", label: "Voz" },
];

function Library() {
  const pid = useActiveProjectId();
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [open, setOpen] = useState<Asset | null>(null);
  const { data: assets = [] } = useCoreQuery(["assets", pid, kind, search, tag], (c) => c.assets.list(pid!, { ...(kind ? { kind } : {}), ...(search ? { search } : {}), ...(tag ? { tag } : {}) }), !!pid);
  const { data: tags = [] } = useCoreQuery(["tags", pid], (c) => c.assets.tags(pid!), !!pid);
  if (!pid) return <NeedProject />;
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Biblioteca</h1><Link to="/jobs" className="text-xs text-primary underline">Trabajos</Link></div>
      <Create projectId={pid} />
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Buscar por nombre o prompt" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={inputCls + " w-28"} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Todo</option><option value="image">Imágenes</option><option value="audio">Audio</option><option value="video">Video</option><option value="document">Documentos</option>
        </select>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">{["", ...tags].map((t) => <button key={t} onClick={() => setTag(t)} className={`rounded-full border px-2 py-0.5 text-xs ${tag === t ? "border-primary bg-primary text-primary-foreground" : ""}`}>{t || "todas"}</button>)}</div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {assets.map((a) => <Thumb key={a.id} a={a} onOpen={() => setOpen(a)} />)}
      </div>
      {!assets.length && <p className="text-center text-sm text-muted-foreground">Aún no hay contenido en este proyecto.</p>}
      {open && <AssetDetail a={open} onClose={() => setOpen(null)} />}
    </div>
  );
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

function Thumb({ a, onOpen }: { a: Asset; onOpen: () => void }) {
  const { url, err } = useAssetUrl(a, a.kind === "image");
  return (
    <button onClick={onOpen} className="overflow-hidden rounded-xl border bg-card text-left">
      <div className="flex aspect-square items-center justify-center bg-secondary/40">
        {a.kind === "image" && url ? <img src={url} alt={a.prompt ?? a.name ?? "imagen"} className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">{err ? "Archivo dañado" : a.kind === "audio" ? "Audio" : a.kind}</span>}
      </div>
      <div className="truncate p-2 text-xs">{a.name ?? a.prompt ?? a.id.slice(0, 8)} {a.version > 1 && `· v${a.version}`}</div>
    </button>
  );
}

function AssetDetail({ a, onClose }: { a: Asset; onClose: () => void }) {
  const { url, err } = useAssetUrl(a);
  const mutate = useCoreMutate();
  const { data: tags = [] } = useCoreQuery(["tags", a.id], (c) => c.assets.tags(a.project_id, a.id));
  const [newTag, setNewTag] = useState("");
  const [edit, setEdit] = useState("");
  const [busy, setBusy] = useState(false);

  async function exportFile() {
    try {
      const c = await getCore();
      const bytes = await c.assets.read(a.project_id, a.id); // verified before export
      const name = a.name ?? `miai-${a.id.slice(0, 8)}.${a.format ?? "bin"}`;
      if (isNative()) {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        await Filesystem.writeFile({ path: `MI AI/${name}`, data: btoa(s), directory: Directory.Documents, recursive: true });
        toast.success(`Exportado sin cifrar a Documentos/MI AI/${name}`);
      } else {
        const l = document.createElement("a"); l.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.mime })); l.download = name; l.click();
      }
    } catch (e) { toast.error((e as Error).message); }
  }
  async function runEdit() {
    if (!edit.trim()) return;
    setBusy(true);
    try {
      const c = await getCore();
      const d = route(await c.repo.registry.listModels(), { capability: "image.edit", mode: "auto" });
      if (!d.ok) { toast.error(d.reason); return; }
      const bytes = await c.assets.read(a.project_id, a.id);
      await execute(c, a.project_id, d.model, { capability: "image.edit", prompt: edit, files: [{ bytes, mime: a.mime, name: `entrada.${a.format ?? "png"}` }], parentAssetId: a.id });
      toast.success(`Nueva versión con ${d.model.name}`);
      setEdit("");
      await mutate(async () => undefined);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-background/95 p-4" role="dialog" aria-modal="true">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex items-center gap-2"><h2 className="flex-1 truncate font-semibold">{a.name ?? a.prompt ?? "Activo"}</h2><Button variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}><X /></Button></div>
        {err && <p className="rounded-md bg-destructive/15 p-2 text-sm text-destructive">No se entrega el archivo: {err}</p>}
        {url && a.kind === "image" && <img src={url} alt={a.prompt ?? "imagen"} className="w-full rounded-xl border" />}
        {url && a.kind === "audio" && <audio controls src={url} className="w-full" />}
        {url && a.kind === "video" && <video controls src={url} className="w-full rounded-xl" />}
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
        {a.kind === "image" && (
          <div className="flex gap-2"><input className={inputCls} placeholder="Editar con instrucciones (crea versión nueva)" value={edit} onChange={(e) => setEdit(e.target.value)} />
            <Button disabled={busy} onClick={runEdit}><Wand2 />{busy ? "…" : ""}</Button></div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" onClick={exportFile}><Download /> Exportar</Button>
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
  const [busy, setBusy] = useState(false);
  const mutate = useCoreMutate();
  const { data: models = [] } = useCoreQuery(["models"], (c) => c.repo.registry.listModels());
  const decision = useMemo(() => route(models, { capability: cap, mode, manualModelId: manual || null }), [models, cap, mode, manual]);
  const compatible = models.filter((m) => m.capabilities.includes(cap) && m.status === "active" && m.provider_enabled);

  async function run() {
    if (!decision.ok) return toast.error(decision.reason);
    if (!prompt.trim()) return toast.error("Escribe una descripción.");
    setBusy(true);
    try {
      const c = await getCore();
      const r = await execute(c, projectId, decision.model, { capability: cap, prompt, params: cap === "image.generate" ? { size, n: 1 } : {} });
      toast.success(`${r.assets.length} archivo(s) guardado(s) cifrados`);
      setPrompt("");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); await mutate(async () => undefined); }
  }

  return (
    <section className="space-y-2 rounded-xl border bg-card p-3 text-sm">
      <div className="flex gap-1">{CREATE_CAPS.map((c) => <button key={c.id} onClick={() => setCap(c.id)} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${cap === c.id ? "border-primary bg-primary text-primary-foreground" : ""}`}>{c.label}</button>)}</div>
      <textarea className={inputCls} rows={3} placeholder={cap === "audio.tts" ? "Texto para convertir en voz" : "Describe la imagen"} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div className="flex gap-2">
        <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as RouteMode)}>
          <option value="auto">Automático</option><option value="favorite">Favoritos</option><option value="manual">Manual</option>
        </select>
        {mode === "manual" && <select className={inputCls} value={manual} onChange={(e) => setManual(e.target.value)}><option value="">Elige modelo</option>{compatible.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        {cap === "image.generate" && <select className={inputCls} value={size} onChange={(e) => setSize(e.target.value)}><option>1024x1024</option><option>1024x1536</option><option>1536x1024</option></select>}
      </div>
      <p className={`text-xs ${decision.ok ? "text-muted-foreground" : "text-destructive"}`}>
        {decision.ok ? <>Modelo: <b>{decision.model.name}</b> — {decision.reasons.join(" · ")}</> : <>{decision.reason} <Link to="/models" className="underline">Registrar un modelo</Link></>}
      </p>
      <Button className="w-full" disabled={busy || !decision.ok} onClick={run}><Sparkles />{busy ? "Generando…" : "Generar"}</Button>
    </section>
  );
}
