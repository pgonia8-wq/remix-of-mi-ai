import { useMemo, useRef, useState } from "react";
import { FolderOpen, Plus, Save, Share2, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { inputCls } from "./AppShell";
import { getCore } from "@/lib/core";
import { useCoreQuery } from "@/lib/use-app";
import { addr, display, evaluateSheet, isErr, numToCol, parseAddr, readSheetFile, writeSheetFile, type Sheet } from "@/lib/docs/sheet-formulas";
import { saveExport } from "@/lib/save-export";
import { shareContent } from "@/lib/device";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME = { xlsx: XLSX_MIME, ods: "application/vnd.oasis.opendocument.spreadsheet", csv: "text/csv" } as const;

/** Spreadsheet with live formulas. Files stay encrypted in the Library; exports only when the person asks. */
export function SheetEditor({ pid }: { pid: string }) {
  const [sheets, setSheets] = useState<Sheet[]>([{ name: "Hoja1", cells: {} }]);
  const [active, setActive] = useState(0), [sel, setSel] = useState("A1"), [name, setName] = useState("Hoja de cálculo");
  const [parent, setParent] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const upload = useRef<HTMLInputElement | null>(null);
  const { data: saved = [], refetch } = useCoreQuery(["sheet-assets", pid], async (c) => (await c.assets.list(pid)).filter((a) => /spreadsheet|ms-excel|text\/csv/.test(a.mime)));
  const sheet = sheets[active] ?? sheets[0]!;
  const values = useMemo(() => evaluateSheet(sheet.cells), [sheet.cells]);
  const used = Object.keys(sheet.cells).map(parseAddr).filter(Boolean) as { col: number; row: number }[];
  const rows = Math.max(20, ...used.map((u) => u.row + 3)), cols = Math.max(6, ...used.map((u) => u.col + 1));
  const setCell = (a: string, v: string) => setSheets((all) => all.map((s, i) => i !== active ? s : { ...s, cells: (() => { const c = { ...s.cells }; if (v === "") delete c[a]; else c[a] = v; return c; })() }));
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };

  async function load(bytes: Uint8Array, n: string, assetId: string | null) {
    const list = await readSheetFile(bytes); if (!list.length) throw new Error("El archivo no tiene hojas.");
    setSheets(list); setActive(0); setSel("A1"); setName(n.replace(/\.(xlsx|xls|ods|csv)$/i, "")); setParent(assetId);
    toast.success(`${list.length} hoja(s) abiertas con sus fórmulas.`);
  }
  const fileName = (ext: string) => `${name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "hoja"}.${ext}`;

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <input className={`${inputCls} min-w-0 flex-1`} aria-label="Nombre de la hoja de cálculo" value={name} onChange={(e) => setName(e.target.value)} />
      <Button variant="outline" size="sm" onClick={() => upload.current?.click()}><Upload />Abrir archivo</Button>
      <input ref={upload} type="file" className="hidden" aria-label="Abrir hoja de cálculo" accept=".xlsx,.xls,.ods,.csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; void run(async () => { if (f.size > 30 * 1024 * 1024) throw new Error("Máximo 30 MB."); await load(new Uint8Array(await f.arrayBuffer()), f.name, null); }); }} />
      {saved.length > 0 && <select aria-label="Abrir hoja guardada" className={inputCls} value="" onChange={(e) => { const a = saved.find((x) => x.id === e.target.value); if (a) void run(async () => { const c = await getCore(); await load(await c.assets.read(pid, a.id), a.name ?? "hoja", a.id); }); }}><option value="">Abrir de Biblioteca…</option>{saved.map((a) => <option key={a.id} value={a.id}>{a.name} · v{a.version}</option>)}</select>}
    </div>
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 rounded-md border bg-muted/40 px-2 py-2 text-center font-mono text-xs">{sel}</span>
      <input className={`${inputCls} font-mono`} aria-label="Contenido o fórmula de la celda" placeholder="Valor o fórmula, p. ej. =SUMA(A1:A5)" value={sheet.cells[sel] ?? ""} onChange={(e) => setCell(sel, e.target.value)} />
    </div>
    <p className="text-xs text-muted-foreground">Resultado: <b>{display(values[sel] ?? null) || "—"}</b>. Funciones: SUMA, PROMEDIO, SI, CONTAR.SI, SUMAR.SI, BUSCARV, REDONDEAR, MIN, MAX y más (también en inglés).</p>
    <div className="flex gap-1 overflow-x-auto">{sheets.map((s, i) => <button key={i} onClick={() => { setActive(i); setSel("A1"); }} className={`rounded-md border px-3 py-1 text-xs ${i === active ? "border-primary bg-primary text-primary-foreground" : ""}`}>{s.name}</button>)}
      <Button size="sm" variant="ghost" aria-label="Agregar hoja" onClick={() => { setSheets((s) => [...s, { name: `Hoja${s.length + 1}`, cells: {} }]); setActive(sheets.length); }}><Plus /></Button></div>
    <div className="max-h-[55vh] overflow-auto rounded-lg border">
      <table className="border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-card"><tr><th className="w-8 border bg-muted/40" />{Array.from({ length: cols }, (_, c) => <th key={c} className="min-w-20 border bg-muted/40 px-1 py-1 font-medium">{numToCol(c + 1)}</th>)}</tr></thead>
        <tbody>{Array.from({ length: rows }, (_, r) => <tr key={r}><th className="sticky left-0 border bg-muted/40 px-1 font-medium">{r + 1}</th>
          {Array.from({ length: cols }, (_, c) => { const a = addr(c + 1, r + 1), v = values[a] ?? null; return <td key={c} onClick={() => setSel(a)} className={`h-7 max-w-40 cursor-cell truncate border px-1 ${a === sel ? "outline outline-2 -outline-offset-2 outline-primary" : ""} ${typeof v === "number" ? "text-right" : ""} ${isErr(v) ? "text-destructive" : ""}`}>{display(v)}</td>; })}</tr>)}</tbody>
      </table>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={() => run(async () => { const c = await getCore(); const bytes = await writeSheetFile(sheets, "xlsx"); const a = await c.assets.put(pid, (async function* () { yield bytes; })(), { kind: "document", mime: XLSX_MIME, name: fileName("xlsx"), capability: "sheet.document", parentId: parent }); setParent(a.id); await refetch(); toast.success(`Guardada cifrada en Biblioteca (v${a.version}).`); })}><Save />Guardar</Button>
      {(["xlsx", "ods", "csv"] as const).map((f) => <Button key={f} variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await saveExport(await writeSheetFile(f === "csv" ? [sheet] : sheets, f), fileName(f), MIME[f]); })}><Download />{f.toUpperCase()}</Button>)}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await shareContent({ file: { data: await writeSheetFile(sheets, "xlsx"), name: fileName("xlsx"), mime: XLSX_MIME }, title: name }); })}><Share2 />Compartir en…</Button>
      {parent && <span className="flex items-center gap-1 text-xs text-muted-foreground"><FolderOpen className="h-3.5 w-3.5" />Cada guardado crea una versión nueva.</span>}
    </div>
  </div>;
}
