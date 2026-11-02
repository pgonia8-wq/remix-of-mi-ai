import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, Plus, Replace, Save, Share2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { inputCls } from "./AppShell";
import { getCore } from "@/lib/core";
import { useCoreQuery } from "@/lib/use-app";
import { docxParagraphs, editDocx, editPptx, officeKind, pptxSlides, type DocxOp, type DocxParagraph, type PptxOp, type PptxSlide } from "@/lib/docs/ooxml-edit";
import { saveExport } from "@/lib/save-export";
import { shareContent } from "@/lib/device";

const MIME = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" } as const;
type Open = { bytes: Uint8Array; name: string; kind: "docx" | "pptx"; assetId: string | null };

/** Edits Word and PowerPoint files keeping their styles, images, themes and notes (only changed text is rewritten). */
export function OfficeEditor({ pid }: { pid: string }) {
  const [doc, setDoc] = useState<Open | null>(null), [busy, setBusy] = useState(false);
  const [paras, setParas] = useState<DocxParagraph[]>([]), [slides, setSlides] = useState<PptxSlide[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({}), [find, setFind] = useState(""), [repl, setRepl] = useState("");
  const upload = useRef<HTMLInputElement | null>(null);
  const { data: saved = [], refetch } = useCoreQuery(["office-assets", pid], async (c) => (await c.assets.list(pid)).filter((a) => officeKind(a.name ?? "", a.mime)));
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };

  function open(o: Open) {
    if (o.kind === "docx") { setParas(docxParagraphs(o.bytes)); setSlides([]); } else { setSlides(pptxSlides(o.bytes)); setParas([]); }
    setDoc(o); setEdits({});
  }
  async function apply(ops: (DocxOp | PptxOp)[], label: string) {
    if (!doc || !ops.length) return;
    const r = doc.kind === "docx" ? editDocx(doc.bytes, ops as DocxOp[]) : editPptx(doc.bytes, ops as PptxOp[]);
    const c = await getCore();
    const a = await c.assets.put(pid, (async function* () { yield r.bytes; })(), { kind: "document", mime: MIME[doc.kind], name: doc.name, capability: "doc.edit", parentId: doc.assetId });
    open({ ...doc, bytes: r.bytes, assetId: a.id }); await refetch();
    toast.success(`${label}: ${r.changes} cambio(s). Versión ${a.version} cifrada en Biblioteca.`);
  }
  const pendingOps = (): (DocxOp | PptxOp)[] => Object.entries(edits).map(([k, text]) => {
    const [t, a, b] = k.split(":");
    if (t === "p") return { op: "setText", index: Number(a), text } as DocxOp;
    if (t === "n") return { op: "setNotes", slide: Number(a), text } as PptxOp;
    return { op: "setShapeText", slide: Number(a), shape: Number(b), text } as PptxOp;
  });

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => upload.current?.click()}><Upload />Abrir Word o PowerPoint</Button>
      <input ref={upload} type="file" className="hidden" aria-label="Abrir documento de Office" accept=".docx,.pptx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; void run(async () => { const kind = officeKind(f.name, f.type); if (!kind) throw new Error("Usa un archivo .docx o .pptx."); if (f.size > 80 * 1024 * 1024) throw new Error("Máximo 80 MB."); const bytes = new Uint8Array(await f.arrayBuffer()); const c = await getCore(); const a = await c.assets.put(pid, (async function* () { yield bytes; })(), { kind: "document", mime: MIME[kind], name: f.name, capability: "doc.source" }); open({ bytes, name: f.name, kind, assetId: a.id }); await refetch(); }); }} />
      {saved.length > 0 && <select aria-label="Abrir documento guardado" className={inputCls} value="" onChange={(e) => { const a = saved.find((x) => x.id === e.target.value); if (a) void run(async () => { const c = await getCore(); open({ bytes: await c.assets.read(pid, a.id), name: a.name ?? "documento", kind: officeKind(a.name ?? "", a.mime)!, assetId: a.id }); }); }}><option value="">Abrir de Biblioteca…</option>{saved.map((a) => <option key={a.id} value={a.id}>{a.name} · v{a.version}</option>)}</select>}
    </div>
    {!doc ? <p className="text-sm text-muted-foreground">Abre un Word o PowerPoint para cambiar textos, notas de orador y el orden de diapositivas. Los estilos, imágenes y diseño se conservan.</p> : <>
      <p className="text-sm font-medium">{doc.name}</p>
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} min-w-0 flex-1`} aria-label="Buscar texto" placeholder="Buscar" value={find} onChange={(e) => setFind(e.target.value)} />
        <input className={`${inputCls} min-w-0 flex-1`} aria-label="Reemplazar por" placeholder="Reemplazar por" value={repl} onChange={(e) => setRepl(e.target.value)} />
        <Button size="sm" variant="outline" disabled={busy || !find} onClick={() => run(() => apply([{ op: "replace", find, replace: repl, all: true }], "Reemplazo"))}><Replace />Reemplazar todo</Button>
      </div>
      {doc.kind === "docx" ? <ol className="space-y-2">{paras.map((p) => <li key={p.index} className="rounded-lg border p-2">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><span>¶ {p.index + 1}{p.style ? ` · ${p.style}` : ""}{p.inTable ? " · tabla" : ""}</span>{p.hasImage && <span>· contiene imagen</span>}
          <span className="ml-auto flex gap-1"><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Insertar párrafo debajo del ${p.index + 1}`} disabled={busy} onClick={() => run(() => apply([{ op: "insertAfter", index: p.index, text: "Nuevo párrafo" }], "Párrafo agregado"))}><Plus className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Eliminar párrafo ${p.index + 1}`} disabled={busy || p.hasImage} onClick={() => run(() => apply([{ op: "delete", index: p.index }], "Párrafo eliminado"))}><Trash2 className="h-3.5 w-3.5" /></Button></span></div>
        {(!p.hasImage || p.text) && <textarea className={`${inputCls} min-h-10`} aria-label={`Texto del párrafo ${p.index + 1}`} value={edits[`p:${p.index}`] ?? p.text} onChange={(e) => setEdits((x) => ({ ...x, [`p:${p.index}`]: e.target.value }))} />}
      </li>)}</ol>
      : <ol className="space-y-3">{slides.map((s) => <li key={s.path} className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center gap-1 text-sm font-medium">Diapositiva {s.number}
          <span className="ml-auto flex gap-1"><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Subir diapositiva ${s.number}`} disabled={busy || s.number === 1} onClick={() => run(() => apply([{ op: "moveSlide", slide: s.number, to: s.number - 1 }], "Orden cambiado"))}><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Bajar diapositiva ${s.number}`} disabled={busy || s.number === slides.length} onClick={() => run(() => apply([{ op: "moveSlide", slide: s.number, to: s.number + 1 }], "Orden cambiado"))}><ArrowDown className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Eliminar diapositiva ${s.number}`} disabled={busy || slides.length < 2} onClick={() => { if (confirm(`¿Eliminar la diapositiva ${s.number}?`)) void run(() => apply([{ op: "deleteSlide", slide: s.number }], "Diapositiva eliminada")); }}><Trash2 className="h-3.5 w-3.5" /></Button></span></div>
        {s.shapes.map((sh) => <label key={sh.index} className="block text-xs text-muted-foreground">{sh.name || `Cuadro ${sh.index + 1}`}
          <textarea className={`${inputCls} mt-1 min-h-10 text-foreground`} value={edits[`s:${s.number}:${sh.index}`] ?? sh.text} onChange={(e) => setEdits((x) => ({ ...x, [`s:${s.number}:${sh.index}`]: e.target.value }))} /></label>)}
        <label className="block text-xs text-muted-foreground">Notas del orador
          <textarea className={`${inputCls} mt-1 min-h-10 text-foreground`} value={edits[`n:${s.number}`] ?? s.notes ?? ""} onChange={(e) => setEdits((x) => ({ ...x, [`n:${s.number}`]: e.target.value }))} /></label>
      </li>)}</ol>}
      <div className="sticky bottom-2 flex flex-wrap gap-2 rounded-xl border bg-card p-2">
        <Button disabled={busy || !Object.keys(edits).length} onClick={() => run(() => apply(pendingOps(), "Cambios guardados"))}><Save />Guardar cambios{Object.keys(edits).length ? ` (${Object.keys(edits).length})` : ""}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await saveExport(doc.bytes, doc.name, MIME[doc.kind]); })}><Download />Guardar como</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await shareContent({ file: { data: doc.bytes, name: doc.name, mime: MIME[doc.kind] }, title: doc.name }); })}><Share2 />Compartir en…</Button>
      </div>
    </>}
  </div>;
}
