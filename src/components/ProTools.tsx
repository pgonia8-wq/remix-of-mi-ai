import { useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/components/AppShell";
import type { DataTable } from "@/lib/data-analysis";
import { cleanColumn, convertUnit, correlation, irr, loan, npv, pivot, projectReport, tableToFile, UNIT_GROUPS, type Agg, type CleanOp } from "@/lib/pro-tools";
import { saveExport } from "@/lib/save-export";
import { getCore } from "@/lib/core";
import { notes as notesApi, tasks as tasksApi } from "@/lib/core/productivity";

const AGG: Record<Agg, string> = { sum: "Suma", count: "Conteo", mean: "Promedio", min: "Mínimo", max: "Máximo" };
const OPS: Record<CleanOp, string> = { trim: "Quitar espacios", lower: "Minúsculas", upper: "Mayúsculas", number: "Convertir a número", dropEmpty: "Quitar filas vacías", dedupe: "Quitar filas repetidas" };

export function DataTools({ table, onChange }: { table: DataTable; onChange: (t: DataTable) => void }) {
  const [g, setG] = useState(0), [v, setV] = useState(Math.min(1, table.headers.length - 1)), [agg, setAgg] = useState<Agg>("sum");
  const [ops, setOps] = useState<CleanOp[]>(["trim"]), [cc, setCc] = useState(0), [b, setB] = useState(Math.min(1, table.headers.length - 1));
  const [corr, setCorr] = useState<string | null>(null);
  const piv = (() => { try { return pivot(table, g, v, agg); } catch { return []; } })();
  const sel = (val: number, set: (n: number) => void, label: string) => <select aria-label={label} className={inputCls} value={val} onChange={(e) => set(Number(e.target.value))}>{table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}</select>;
  return (
    <div className="space-y-4">
      <section className="space-y-2 border-t pt-3">
        <h2 className="font-semibold">Tabla dinámica y gráfico</h2>
        <div className="grid grid-cols-3 gap-2">{sel(g, setG, "Agrupar por")}{sel(v, setV, "Valor")}<select aria-label="Cálculo" className={inputCls} value={agg} onChange={(e) => setAgg(e.target.value as Agg)}>{Object.entries(AGG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {piv.length > 0 && <div className="h-56 w-full"><ResponsiveContainer><BarChart data={piv.slice(0, 20)}><XAxis dataKey="group" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="value" fill="var(--primary)" /></BarChart></ResponsiveContainer></div>}
        <div className="max-h-48 overflow-auto"><table className="w-full text-xs"><thead><tr><th className="text-left">{table.headers[g]}</th><th className="text-right">{AGG[agg]} de {table.headers[v]}</th><th className="text-right">Filas</th></tr></thead><tbody>{piv.map((r) => <tr key={r.group}><td>{r.group}</td><td className="text-right">{r.value.toLocaleString()}</td><td className="text-right">{r.n}</td></tr>)}</tbody></table></div>
        <Button size="sm" variant="outline" disabled={!piv.length} onClick={async () => saveExport(await tableToFile({ name: "Tabla dinámica", headers: [table.headers[g] ?? "Grupo", `${AGG[agg]} ${table.headers[v]}`, "Filas"], rows: piv.map((r) => [r.group, r.value, r.n]) }, "xlsx"), "tabla-dinamica.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>Exportar Excel</Button>
      </section>
      <section className="space-y-2 border-t pt-3">
        <h2 className="font-semibold">Limpiar una columna</h2>
        {sel(cc, setCc, "Columna a limpiar")}
        <div className="flex flex-wrap gap-2 text-xs">{(Object.keys(OPS) as CleanOp[]).map((o) => <label key={o} className="flex items-center gap-1"><input type="checkbox" checked={ops.includes(o)} onChange={(e) => setOps(e.target.checked ? [...ops, o] : ops.filter((x) => x !== o))} />{OPS[o]}</label>)}</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { const r = cleanColumn(table, cc, ops); onChange(r.table); toast.success(`${r.changed} celdas cambiadas, ${r.removed} filas quitadas. El archivo original no se modifica.`); }}>Aplicar</Button>
          <Button size="sm" variant="outline" onClick={async () => saveExport(await tableToFile(table, "csv"), `${table.name}.csv`, "text/csv")}>Exportar CSV</Button>
          <Button size="sm" variant="outline" onClick={async () => saveExport(await tableToFile(table, "xlsx"), `${table.name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>Exportar Excel</Button>
        </div>
      </section>
      <section className="space-y-2 border-t pt-3">
        <h2 className="font-semibold">Relación entre dos columnas</h2>
        <div className="grid grid-cols-2 gap-2">{sel(cc, setCc, "Columna A")}{sel(b, setB, "Columna B")}</div>
        <Button size="sm" variant="outline" onClick={() => { try { const r = correlation(table, cc, b); setCorr(`Correlación r = ${r.r} con ${r.n} filas. ${Math.abs(r.r) >= 0.7 ? "Relación fuerte" : Math.abs(r.r) >= 0.3 ? "Relación moderada" : "Relación débil"}; no demuestra causa.`); } catch (e) { setCorr((e as Error).message); } }}>Calcular</Button>
        {corr && <p className="text-xs">{corr}</p>}
      </section>
    </div>
  );
}

export function Calculators({ pid }: { pid: string }) {
  const [l, setL] = useState({ principal: 100000, rate: 12, months: 24 });
  const [flows, setFlows] = useState("-1000, 300, 400, 500"), [rate, setRate] = useState(10);
  const [u, setU] = useState({ group: "longitud", from: "m", to: "ft", value: 1 });
  const loanRes = (() => { try { return loan(l.principal, l.rate, l.months); } catch (e) { return (e as Error).message; } })();
  const cf = flows.split(/[,;\s]+/).filter(Boolean).map(Number);
  const npvRes = (() => { try { return npv(rate, cf); } catch { return null; } })();
  const irrRes = cf.every(Number.isFinite) ? irr(cf) : null;
  const unitRes = (() => { try { return convertUnit(u.value, u.from, u.to); } catch (e) { return (e as Error).message; } })();
  const units = UNIT_GROUPS[u.group] ?? [];
  async function report() {
    const c = await getCore();
    const p = await c.repo.getProject(pid);
    const md = projectReport({ name: p?.name ?? "Proyecto", tasks: await tasksApi.list(c.repo.sql, pid), notes: await notesApi.list(c.repo.sql, pid), spend: await c.repo.monthSpend(pid), budget: await c.repo.getProjectBudget(pid) });
    await c.assets.put(pid, (async function* () { yield new TextEncoder().encode(md); })(), { kind: "text", mime: "text/markdown", name: "Informe del proyecto.md", capability: "pro.report" });
    toast.success("Informe del proyecto guardado cifrado en la Biblioteca");
  }
  const num = (v: string) => Number(v) || 0;
  return (
    <div className="space-y-4">
      <section className="space-y-2 border-t pt-3">
        <h2 className="font-semibold">Préstamo (cuota fija)</h2>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label>Monto<input className={inputCls} type="number" value={l.principal} onChange={(e) => setL({ ...l, principal: num(e.target.value) })} /></label>
          <label>Tasa anual %<input className={inputCls} type="number" value={l.rate} onChange={(e) => setL({ ...l, rate: num(e.target.value) })} /></label>
          <label>Meses<input className={inputCls} type="number" value={l.months} onChange={(e) => setL({ ...l, months: Math.round(num(e.target.value)) })} /></label>
        </div>
        {typeof loanRes === "string" ? <p className="text-xs text-destructive">{loanRes}</p> : <><p className="text-sm">Cuota mensual: <b>{loanRes.payment.toLocaleString()}</b> · Total pagado: {loanRes.totalPaid.toLocaleString()} · Intereses: {loanRes.totalInterest.toLocaleString()}</p>
          <Button size="sm" variant="outline" onClick={async () => saveExport(await tableToFile({ name: "Amortizacion", headers: ["Mes", "Cuota", "Interés", "Capital", "Saldo"], rows: loanRes.schedule.map((r) => [r.month, r.payment, r.interest, r.principal, r.balance]) }, "xlsx"), "tabla-amortizacion.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>Exportar tabla de amortización</Button></>}
      </section>
      <section className="space-y-2 border-t pt-3">
        <h2 className="font-semibold">VAN y TIR</h2>
        <label className="text-xs">Flujos por periodo (el primero suele ser la inversión, negativa)<input className={inputCls} value={flows} onChange={(e) => setFlows(e.target.value)} /></label>
        <label className="text-xs">Tasa de descuento %<input className={inputCls} type="number" value={rate} onChange={(e) => setRate(num(e.target.value))} /></label>
        <p className="text-sm">VAN: <b>{npvRes === null ? "—" : npvRes.toLocaleString()}</b> · TIR: <b>{irrRes === null ? "sin TIR (no hay cambio de signo)" : `${irrRes}%`}</b></p>
      </section>
      <section className="space-y-2 border-t pt-3">
        <h2 className="font-semibold">Conversión de unidades</h2>
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Tipo de unidad" className={inputCls} value={u.group} onChange={(e) => { const us = UNIT_GROUPS[e.target.value] ?? []; setU({ ...u, group: e.target.value, from: us[0] ?? "", to: us[1] ?? us[0] ?? "" }); }}>{Object.keys(UNIT_GROUPS).map((g) => <option key={g}>{g}</option>)}</select>
          <input aria-label="Valor a convertir" className={inputCls} type="number" value={u.value} onChange={(e) => setU({ ...u, value: Number(e.target.value) })} />
          <select aria-label="Desde" className={inputCls} value={u.from} onChange={(e) => setU({ ...u, from: e.target.value })}>{units.map((x) => <option key={x}>{x}</option>)}</select>
          <select aria-label="Hacia" className={inputCls} value={u.to} onChange={(e) => setU({ ...u, to: e.target.value })}>{units.map((x) => <option key={x}>{x}</option>)}</select>
        </div>
        <p className="text-sm">{u.value} {u.from} = <b>{typeof unitRes === "number" ? unitRes.toLocaleString(undefined, { maximumFractionDigits: 6 }) : unitRes}</b> {typeof unitRes === "number" ? u.to : ""}</p>
      </section>
      <section className="space-y-2 border-t pt-3">
        <h2 className="font-semibold">Informe del proyecto</h2>
        <p className="text-xs text-muted-foreground">Resume tareas, notas y gasto del mes de este proyecto, sin usar ningún modelo.</p>
        <Button size="sm" onClick={() => report().catch((e) => toast.error((e as Error).message))}>Crear informe</Button>
      </section>
      <p className="text-xs text-muted-foreground">Cálculos matemáticos, no predicciones ni asesoramiento financiero.</p>
    </div>
  );
}
