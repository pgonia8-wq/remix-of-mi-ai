import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { BarChart3, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NeedProject, inputCls } from "@/components/AppShell";
import { useActiveProjectId, useCoreMutate } from "@/lib/use-app";
import { analyzeColumn, readTables, costScenario, type DataTable, type ColumnStats } from "@/lib/data-analysis";
import { askModel } from "@/lib/core/ai";
import { DataTools, Calculators } from "@/components/ProTools";
export const Route = createFileRoute("/data")({ head: () => ({ meta: [
  { title: "Datos y presupuestos — MI AI" }, { name: "description", content: "Estadísticas CSV y Excel, gráficos y escenarios de costos locales." },
  { property: "og:title", content: "Datos y presupuestos — MI AI" }, { property: "og:description", content: "Analiza datos numéricos y prepara informes ejecutivos." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: Page });
function Page() { const p = useActiveProjectId(); return p ? <Data key={p} pid={p} /> : <NeedProject />; }
function Data({ pid }: { pid: string }) {
  const mutate = useCoreMutate(), upload = useRef<HTMLInputElement | null>(null);
  const [tables, setTables] = useState<DataTable[]>([]), [sheet, setSheet] = useState(0), [column, setColumn] = useState(0), [stats, setStats] = useState<ColumnStats | null>(null), [busy, setBusy] = useState(false);
  const [values, setValues] = useState({ units: 0, price: 0, variable: 0, fixed: 0 });
  const t = tables[sheet], scenario = costScenario(values.units, values.price, values.variable, values.fixed);
  const report = stats ? `# Análisis de ${t?.name}\n\nColumna: ${stats.column}\n\n| Métrica | Valor |\n|---|---|\n${Object.entries(stats).filter(([k]) => !["column", "anomalies"].includes(k)).map(([k,v]) => `| ${k} | ${v} |`).join("\n")}\n\nAnomalías (filas de datos): ${stats.anomalies.map((r) => r + 1).join(", ") || "Ninguna por criterio de 3 desviaciones estándar"}.\n\n# Escenario\nIngresos: ${scenario.revenue}; costos: ${scenario.costs}; resultado: ${scenario.profit}.\nEscenario matemático, no predicción ni asesoramiento financiero.` : `# Escenario\n${JSON.stringify(scenario, null, 2)}\nNo es una predicción.`;
  async function save(ai = false) {
    setBusy(true); try { await mutate(async (c) => {
      let text = report;
      if (ai) text = (await askModel(c, pid, `Redacta un informe ejecutivo basado solo en estas estadísticas. Explica limitaciones, incertidumbre y posibles acciones. No inventes causalidad, no es asesoramiento financiero, legal o médico:\n${report}`, { save: { name: "Informe ejecutivo.md" } })).text;
      else await c.assets.put(pid, (async function* () { yield new TextEncoder().encode(text); })(), { kind: "text", mime: "text/markdown", name: "Análisis de datos.md" });
    }); toast.success("Informe guardado en Biblioteca"); } catch (e) { toast.error(e instanceof Error ? e.message : "No se guardó."); } finally { setBusy(false); }
  }
  return <div className="space-y-4 p-4"><div className="flex gap-2"><BarChart3 className="text-primary" /><h1 className="text-2xl font-bold">Datos y presupuestos</h1></div>
    <input aria-label="Archivo de datos" type="file" accept=".csv,.xlsx,.xls" className="hidden" ref={upload} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setTables(await readTables(new Uint8Array(await f.arrayBuffer()))); setSheet(0); setColumn(0); setStats(null); } catch (err) { toast.error(err instanceof Error ? err.message : "Archivo no válido."); } e.target.value = ""; }} />
    <Button variant="outline" onClick={() => upload.current?.click()}><Upload />CSV / Excel</Button>
    {t && <div className="space-y-3"><select className={inputCls} aria-label="Hoja" value={sheet} onChange={(e) => { setSheet(Number(e.target.value)); setColumn(0); setStats(null); }}>{tables.map((x,i) => <option key={i} value={i}>{x.name}</option>)}</select><select aria-label="Columna numérica" className={inputCls} value={column} onChange={(e) => setColumn(Number(e.target.value))}>{t.headers.map((h,i) => <option key={i} value={i}>{h}</option>)}</select><Button onClick={() => { try { setStats(analyzeColumn(t, column)); } catch (e) { toast.error(e instanceof Error ? e.message : "Sin datos"); } }}>Analizar columna</Button>
      <div className="max-h-64 overflow-auto"><table className="w-full text-xs"><thead><tr>{t.headers.map((h,i) => <th key={i} className="border-b p-2 text-left">{h}</th>)}</tr></thead><tbody>{t.rows.slice(0, 50).map((r,i) => <tr key={i}>{r.map((v,j) => <td className="border-b p-2" key={j}>{String(v ?? "")}</td>)}</tr>)}</tbody></table></div>
    </div>}
    {stats && <div className="space-y-3"><h2 className="font-semibold">{stats.column}</h2><dl className="grid grid-cols-2 gap-2 text-sm">{[{ label: "Datos válidos", v: stats.count }, { label: "Sin número", v: stats.missing }, { label: "Media", v: stats.mean }, { label: "Mediana", v: stats.median }, { label: "Mínimo", v: stats.min }, { label: "Máximo", v: stats.max }, { label: "Suma", v: stats.sum }, { label: "Desviación", v: stats.std }].map((x) => <div className="border-b py-2" key={x.label}><dt className="text-xs text-muted-foreground">{x.label}</dt><dd>{x.v.toLocaleString(undefined, { maximumFractionDigits: 4 })}</dd></div>)}</dl>
      <div role="img" aria-label="Gráfico de los primeros veinte valores" className="space-y-1">{t?.rows.slice(0,20).map((r,i) => { const value = Number(r[column]); const width = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.abs(value) / (Math.max(Math.abs(stats.min),Math.abs(stats.max)) || 1) * 100)) : 0; return <div key={i} className="flex items-center gap-2 text-xs"><span className="w-6 shrink-0">{i+1}</span><meter min={0} max={100} value={width} className="h-4 min-w-0 flex-1" /><span className="w-16 shrink-0 text-right">{Number.isFinite(value) ? value : "—"}</span></div>; })}</div>
      <p className="text-xs text-muted-foreground">Anomalías por criterio de 3 desviaciones: {stats.anomalies.length}. No prueban errores ni causalidad.</p>
    </div>}
    {t && <DataTools key={`${sheet}-${t.rows.length}`} table={t} onChange={(nt) => setTables(tables.map((x, i) => (i === sheet ? nt : x)))} />}
    <h2 className="font-semibold">Escenario de costos</h2><div className="grid grid-cols-2 gap-2">{[{ key: "units", label: "Unidades" }, { key: "price", label: "Precio por unidad" }, { key: "variable", label: "Costo por unidad" }, { key: "fixed", label: "Costos fijos" }].map((x) => <label className="text-xs" key={x.key}>{x.label}<input type="number" min={0} className={inputCls} value={values[x.key as keyof typeof values]} onChange={(e) => setValues({ ...values, [x.key]: Math.max(0, Number(e.target.value) || 0) })} /></label>)}</div>
    <dl className="space-y-1 text-sm"><div>Ingresos: {scenario.revenue}</div><div>Costos: {scenario.costs}</div><div>Resultado: {scenario.profit}</div><div>Punto de equilibrio: {scenario.breakEven === null ? "No alcanzable con estos valores" : scenario.breakEven.toFixed(2) + " unidades"}</div></dl>
    <p className="text-xs text-muted-foreground">Escenario matemático, no predicción ni asesoramiento financiero.</p>
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => save()}><Save />Guardar informe</Button><Button variant="outline" disabled={busy || !stats} onClick={() => save(true)}>Informe ejecutivo con IA</Button></div>
    <h2 className="pt-2 text-xl font-bold">Calculadoras profesionales</h2>
    <Calculators pid={pid} />
  </div>;
}