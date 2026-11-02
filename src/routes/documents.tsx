import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileText, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { askModel, clipSource } from "@/lib/core/ai";
import type { RouteMode } from "@/lib/core/router";
import { DOC_TEMPLATES } from "@/lib/core/productivity";
import { DOC_ACCEPT, docKind, extractText } from "@/lib/docs/extract";
import { exportDoc, EXPORT_MIME, type ExportFormat } from "@/lib/docs/export";
import { saveExport } from "@/lib/save-export";
import { savePrivateFile } from "@/lib/files";
import { compareTexts, comparisonMarkdown, type Comparison } from "@/lib/docs/compare";
import { NeedProject, inputCls } from "@/components/AppShell";
import { ModelPicker } from "@/components/ModelPicker";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Documentos — MI AI" },
      { name: "description", content: "Analiza PDF, Word y Excel en tu teléfono, y crea documentos exportables a PDF, Word y Excel." },
      { property: "og:title", content: "Documentos — MI AI" },
      { property: "og:description", content: "Resumir, preguntar, extraer tablas y crear documentos con tus modelos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Documents,
});

const ACTIONS = [
  { id: "summary", label: "Resumir", prompt: "Resume el documento en español: idea principal, puntos clave en viñetas y conclusiones." },
  { id: "tables", label: "Extraer tablas", prompt: "Extrae todos los datos tabulares o estructurados del documento como tablas Markdown limpias con encabezados. Si no hay, dilo." },
  { id: "data", label: "Datos clave", prompt: "Extrae los datos clave del documento (fechas, montos, nombres, obligaciones, plazos) en una tabla Markdown Campo | Valor | Ubicación." },
  { id: "tasks", label: "Pendientes", prompt: "Lista las acciones o pendientes que se desprenden del documento como viñetas '- [ ] tarea'." },
] as const;

function Documents() {
  const pid = useActiveProjectId();
  const [tab, setTab] = useState<"analyze" | "create" | "compare">("analyze");
  if (!pid) return <NeedProject />;
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-bold">Documentos</h1>
      <div className="flex gap-1">
        {(["analyze", "create", "compare"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${tab === t ? "border-primary bg-primary text-primary-foreground" : ""}`}>{t === "analyze" ? "Analizar" : t === "create" ? "Crear" : "Comparar"}</button>)}
      </div>
      {tab === "analyze" ? <Analyze pid={pid} /> : tab === "create" ? <Create pid={pid} /> : <Compare pid={pid} />}
    </div>
  );
}

function Analyze({ pid }: { pid: string }) {
  const { data: docs = [] } = useCoreQuery(["docs", pid], (c) => c.repo.listDocs(pid));
  const mutate = useCoreMutate();
  const [sel, setSel] = useState<string>("");
  const [mode, setMode] = useState<RouteMode>("auto");
  const [manual, setManual] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const doc = docs.find((d) => d.id === sel) ?? null;

  async function upload(files: FileList | null) {
    for (const f of Array.from(files ?? [])) {
      if (docKind(f.name, f.type) === "unsupported") { toast.error(`${f.name}: formato no admitido.`); continue; }
      setBusy(`Leyendo ${f.name}…`);
      try {
        // Text extraction needs the whole document in memory; very large files are refused instead of closing the app.
        if (f.size > 150 * 1024 * 1024) throw new Error(`${f.name}: supera 150 MB. Divídelo o guárdalo en Biblioteca.`);
        const bytes = new Uint8Array(await f.arrayBuffer());
        let ex = await extractText(bytes, f.name, f.type);
        if (ex.warning === "scanned") {
          // Scanned PDF: recognize the pages on the phone with OCR.
          const { ocrPdf } = await import("@/lib/docs/ocr");
          const r = await ocrPdf(bytes, "spa+eng", (s) => setBusy(`${f.name}: ${s}`));
          ex = { text: r.text, ...(ex.pages ? { pages: ex.pages } : {}), ...(r.truncated ? { warning: "OCR aplicado a las primeras 30 páginas." } : r.confidence < 60 ? { warning: `Texto leído con OCR (confianza ${r.confidence}%). Revisa los datos importantes.` } : {}) };
        }
        if (ex.warning) toast.warning(ex.warning);
        const filePath = await savePrivateFile(pid, f);
        const id = await mutate((c) => c.repo.addDoc(pid, { name: f.name, mime: f.type || "application/octet-stream", size: f.size, text: ex.text || null, filePath }));
        setSel(id);
        toast.success(`${f.name}: ${ex.pages ? `${ex.pages} páginas, ` : ""}${ex.text.length.toLocaleString()} caracteres leídos en el teléfono`);
      } catch (e) { toast.error(`${f.name}: ${(e as Error).message}`); } finally { setBusy(null); }
    }
  }

  async function run(label: string, instruction: string) {
    if (!doc?.text_content) { toast.error("Elige un documento con texto."); return; }
    setBusy(`${label}…`); setOut(null);
    try {
      const c = await getCore();
      const r = await askModel(c, pid, `${instruction}\n\nDocumento «${doc.name}»:\n"""\n${clipSource(doc.text_content)}\n"""`, { mode, manualModelId: manual || null, save: { name: `${label} — ${doc.name}.md` } });
      setOut(r.text);
      await mutate(async () => undefined);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm"><Upload className="h-4 w-4" /> Subir PDF, Word, Excel, CSV, texto o foto
        <input type="file" multiple accept={DOC_ACCEPT} className="hidden" onChange={(e) => upload(e.target.files)} /></label>
      <p className="text-[10px] text-muted-foreground">Lectura local sin conexión. Solo se envía al modelo cuando pulsas una acción.</p>
      <div className="space-y-1">
        {docs.map((d) => (
          <div key={d.id} className={`flex items-center gap-2 rounded-xl border p-2 text-sm ${sel === d.id ? "border-primary bg-primary/10" : "bg-card"}`}>
            <button className="flex flex-1 items-center gap-2 text-left" onClick={() => { setSel(d.id); setOut(null); }}>
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1"><span className="block truncate">{d.name}</span><span className="text-[10px] text-muted-foreground">{(d.size / 1024).toFixed(0)} KB · {d.text_content ? `${d.text_content.length.toLocaleString()} caracteres` : "sin texto"}</span></span>
            </button>
            <button aria-label="Eliminar documento" onClick={() => confirm(`¿Eliminar ${d.name}?`) && mutate((c) => c.repo.deleteDoc(pid, d.id))}><Trash2 className="h-4 w-4 text-muted-foreground" /></button>
          </div>
        ))}
        {!docs.length && <p className="text-center text-xs text-muted-foreground">Aún no hay documentos en este proyecto.</p>}
      </div>
      {doc && (
        <section className="space-y-2 rounded-xl border bg-card p-3">
          <ModelPicker capability="chat" mode={mode} setMode={setMode} manual={manual} setManual={setManual} />
          <div className="grid grid-cols-2 gap-1">{ACTIONS.map((a) => <Button key={a.id} size="sm" variant="outline" disabled={!!busy} onClick={() => run(a.label, a.prompt)}>{a.label}</Button>)}</div>
          <div className="flex gap-2">
            <input className={inputCls} placeholder="Pregunta sobre el documento" value={question} onChange={(e) => setQuestion(e.target.value)} />
            <Button disabled={!!busy || !question.trim()} onClick={() => run("Pregunta", `Responde usando solo el documento y cita la página o sección. Si no está en el documento, dilo.\nPregunta: ${question}`)}><Sparkles /></Button>
          </div>
        </section>
      )}
      {busy && <p className="text-xs text-primary">{busy}</p>}
      {out && <Result text={out} title={doc?.name ?? "resultado"} />}
    </div>
  );
}

function Result({ text, title }: { text: string; title: string }) {
  async function exp(f: ExportFormat) {
    try { await saveExport(await exportDoc(text, f, title), `${title.replace(/\.[a-z0-9]+$/i, "").slice(0, 60)}.${f}`, EXPORT_MIME[f]); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <section className="space-y-2 rounded-xl border bg-card p-3">
      <Markdown text={text} />
      <p className="text-[10px] text-muted-foreground">Guardado cifrado en la Biblioteca. Exportar crea una copia sin cifrar.</p>
      <div className="grid grid-cols-5 gap-1">{(["pdf", "docx", "xlsx", "pptx", "md"] as const).map((f) => <Button key={f} size="sm" variant="outline" onClick={() => exp(f)}>{f.toUpperCase()}</Button>)}</div>
    </section>
  );
}

function Create({ pid }: { pid: string }) {
  const { data: docs = [] } = useCoreQuery(["docs", pid], (c) => c.repo.listDocs(pid));
  const mutate = useCoreMutate();
  const [tpl, setTpl] = useState(DOC_TEMPLATES[0]!.id);
  const [brief, setBrief] = useState("");
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<RouteMode>("auto");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const t = DOC_TEMPLATES.find((x) => x.id === tpl)!;
  async function run() {
    if (!brief.trim()) { toast.error("Describe el documento que necesitas."); return; }
    setBusy(true); setOut(null);
    try {
      const c = await getCore();
      const src = docs.find((d) => d.id === source);
      const prompt = `${t.instructions}\nResponde solo con el documento en Markdown (encabezados #, listas y tablas Markdown), en español.\n\nSolicitud: ${brief}${src?.text_content ? `\n\nUsa como fuente este documento «${src.name}»:\n"""\n${clipSource(src.text_content, 40_000)}\n"""` : ""}`;
      const r = await askModel(c, pid, prompt, { mode, manualModelId: manual || null, save: { name: `${t.label} — ${brief.slice(0, 40)}.md` } });
      setOut(r.text);
      await mutate(async () => undefined);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap gap-1">{DOC_TEMPLATES.map((x) => <button key={x.id} onClick={() => setTpl(x.id)} className={`rounded-full border px-2 py-1 text-xs ${tpl === x.id ? "border-primary bg-primary text-primary-foreground" : ""}`}>{x.label}</button>)}</div>
        <textarea className={inputCls} rows={4} placeholder="¿Qué documento necesitas? Destinatario, objetivo, datos a incluir…" value={brief} onChange={(e) => setBrief(e.target.value)} />
        <select aria-label="Documento fuente" className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}><option value="">Sin documento fuente</option>{docs.filter((d) => d.text_content).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <ModelPicker capability="chat" mode={mode} setMode={setMode} manual={manual} setManual={setManual} />
        <Button className="w-full" disabled={busy} onClick={run}><Sparkles />{busy ? "Escribiendo…" : "Crear documento"}</Button>
      </section>
      {out && <Result text={out} title={`${t.label} ${new Date().toISOString().slice(0, 10)}`} />}
    </div>
  );
}

function Compare({ pid }: { pid: string }) {
  const { data: docs = [] } = useCoreQuery(["docs", pid], (c) => c.repo.listDocs(pid));
  const withText = docs.filter((d) => d.text_content);
  const [a, setA] = useState(""), [b, setB] = useState(""), [gran, setGran] = useState<"lines" | "words">("lines");
  const [res, setRes] = useState<Comparison | null>(null);
  const da = withText.find((d) => d.id === a), db = withText.find((d) => d.id === b);
  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-xl border bg-card p-3">
        <p className="text-xs text-muted-foreground">Compara dos documentos en el teléfono, sin enviar nada a un modelo.</p>
        <select aria-label="Documento original" className={inputCls} value={a} onChange={(e) => setA(e.target.value)}><option value="">Documento original</option>{withText.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select aria-label="Documento nuevo" className={inputCls} value={b} onChange={(e) => setB(e.target.value)}><option value="">Documento nuevo</option>{withText.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select aria-label="Detalle de comparación" className={inputCls} value={gran} onChange={(e) => setGran(e.target.value as "lines" | "words")}><option value="lines">Por líneas</option><option value="words">Por palabras</option></select>
        <Button className="w-full" disabled={!da || !db || a === b} onClick={() => setRes(compareTexts(da!.text_content!.slice(0, 400_000), db!.text_content!.slice(0, 400_000), gran))}>Comparar</Button>
      </section>
      {res && da && db && (
        <section className="space-y-2 rounded-xl border bg-card p-3">
          <p className="text-sm">Similitud <b>{res.similarity}%</b> · <span className="text-primary">+{res.added}</span> · <span className="text-destructive">−{res.removed}</span></p>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-xs">{res.parts.map((p, i) => <span key={i} className={p.kind === "added" ? "bg-primary/20" : p.kind === "removed" ? "bg-destructive/20 line-through" : "text-muted-foreground"}>{p.text}</span>)}</pre>
          <Result text={comparisonMarkdown(da.name, db.name, res)} title={`Comparación ${da.name}`} />
        </section>
      )}
    </div>
  );
}
