// Deterministic local professional tools: data pivots/cleaning/correlation and financial/unit calculators.
// Calculations, not predictions or financial advice.
import type { DataTable } from "./data-analysis";

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : NaN);

export type Agg = "sum" | "count" | "mean" | "min" | "max";
export function pivot(t: DataTable, groupCol: number, valueCol: number, agg: Agg): { group: string; value: number; n: number }[] {
  const g = new Map<string, number[]>();
  for (const r of t.rows) {
    const k = String(r[groupCol] ?? "(vacío)");
    const v = num(r[valueCol]);
    if (!g.has(k)) g.set(k, []);
    if (agg === "count" || Number.isFinite(v)) g.get(k)!.push(agg === "count" ? 1 : v);
  }
  const out = [...g.entries()].map(([group, vs]) => {
    const n = vs.length;
    const value = agg === "count" ? n : !n ? 0 : agg === "sum" ? vs.reduce((a, b) => a + b, 0) : agg === "mean" ? vs.reduce((a, b) => a + b, 0) / n : agg === "min" ? Math.min(...vs) : Math.max(...vs);
    return { group, value: Math.round(value * 1e6) / 1e6, n };
  });
  return out.sort((a, b) => b.value - a.value);
}

export type CleanOp = "trim" | "lower" | "upper" | "number" | "dropEmpty" | "dedupe";
/** Returns a new table; the original file is never modified. */
export function cleanColumn(t: DataTable, col: number, ops: CleanOp[]): { table: DataTable; changed: number; removed: number } {
  let changed = 0;
  let rows = t.rows.map((r) => {
    const row = [...r]; let v = row[col];
    if (typeof v === "string") {
      const before = v;
      if (ops.includes("trim")) v = v.trim().replace(/\s+/g, " ");
      if (ops.includes("lower")) v = (v as string).toLowerCase();
      if (ops.includes("upper")) v = (v as string).toUpperCase();
      if (ops.includes("number")) { const n = num(v); v = Number.isFinite(n) ? n : null; }
      if (v !== before) changed++;
    }
    row[col] = v; return row;
  });
  const start = rows.length;
  if (ops.includes("dropEmpty")) rows = rows.filter((r) => r[col] !== null && r[col] !== undefined && String(r[col]).trim() !== "");
  if (ops.includes("dedupe")) { const seen = new Set<string>(); rows = rows.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }); }
  return { table: { ...t, rows }, changed, removed: start - rows.length };
}

/** Pearson correlation over rows where both values are numeric. */
export function correlation(t: DataTable, a: number, b: number): { r: number; n: number } {
  const pairs = t.rows.map((r) => [num(r[a]), num(r[b])] as const).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = pairs.length; if (n < 3) throw new Error("Se necesitan al menos 3 filas con ambos valores numéricos.");
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n, my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (!sxx || !syy) throw new Error("Una de las columnas no varía.");
  return { r: Math.round((sxy / Math.sqrt(sxx * syy)) * 10000) / 10000, n };
}

export async function tableToFile(t: DataTable, fmt: "csv" | "xlsx"): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([t.headers, ...t.rows]);
  if (fmt === "csv") return new TextEncoder().encode(XLSX.utils.sheet_to_csv(ws));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, t.name.slice(0, 31) || "Datos");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

// ---------- Finance ----------
/** Fixed-rate loan (French amortization). annualRate in %, months > 0. */
export function loan(principal: number, annualRate: number, months: number) {
  if (!(principal > 0) || !(annualRate >= 0) || !(Number.isInteger(months) && months > 0 && months <= 1200)) throw new Error("Revisa monto, tasa y plazo (1–1200 meses).");
  const i = annualRate / 100 / 12;
  const payment = i === 0 ? principal / months : (principal * i) / (1 - (1 + i) ** -months);
  let balance = principal; const schedule: { month: number; payment: number; interest: number; principal: number; balance: number }[] = [];
  for (let m = 1; m <= months; m++) {
    const interest = balance * i, amort = payment - interest; balance = Math.max(0, balance - amort);
    schedule.push({ month: m, payment: r2(payment), interest: r2(interest), principal: r2(amort), balance: r2(balance) });
  }
  return { payment: r2(payment), totalPaid: r2(payment * months), totalInterest: r2(payment * months - principal), schedule };
}
const r2 = (x: number) => Math.round(x * 100) / 100 + 0; // +0 normalizes -0

/** Net present value; cashflows[0] is at t=0 (usually negative). rate in %. */
export function npv(ratePct: number, cashflows: number[]) {
  if (!cashflows.length || !cashflows.every(Number.isFinite)) throw new Error("Flujos no válidos.");
  const r = ratePct / 100;
  return r2(cashflows.reduce((s, c, t) => s + c / (1 + r) ** t, 0));
}

/** Internal rate of return (%) by bisection; null when the flows have no sign change. */
export function irr(cashflows: number[]): number | null {
  if (!cashflows.some((c) => c < 0) || !cashflows.some((c) => c > 0)) return null;
  const f = (r: number) => cashflows.reduce((s, c, t) => s + c / (1 + r) ** t, 0);
  let lo = -0.9999, hi = 10;
  if (f(lo) * f(hi) > 0) return null;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  return Math.round(((lo + hi) / 2) * 1e6) / 1e4;
}

// ---------- Units ----------
const UNITS: Record<string, Record<string, number>> = {
  longitud: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
  masa: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237 },
  volumen: { ml: 0.001, l: 1, m3: 1000, gal: 3.785411784, "fl oz": 0.0295735295625 },
  area: { m2: 1, km2: 1e6, ha: 1e4, ft2: 0.09290304, acre: 4046.8564224 },
  velocidad: { "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, nudo: 0.514444 },
  datos: { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 },
};
export const UNIT_GROUPS = Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, Object.keys(v)])) as Record<string, string[]>;
UNIT_GROUPS["temperatura"] = ["°C", "°F", "K"];
export function convertUnit(value: number, from: string, to: string): number {
  if (!Number.isFinite(value)) throw new Error("Valor no válido.");
  const temp = ["°C", "°F", "K"];
  if (temp.includes(from) && temp.includes(to)) {
    const c = from === "°C" ? value : from === "°F" ? (value - 32) * (5 / 9) : value - 273.15;
    const out = to === "°C" ? c : to === "°F" ? c * (9 / 5) + 32 : c + 273.15;
    return Math.round(out * 1e6) / 1e6;
  }
  const g = Object.values(UNITS).find((u) => from in u && to in u);
  if (!g) throw new Error("Unidades de distinto tipo.");
  return Math.round(((value * g[from]!) / g[to]!) * 1e9) / 1e9;
}

/** Project status report from local data (notes, tasks, monthly spend) — no model involved. */
export function projectReport(p: { name: string; tasks: { title: string; done: number; due_at: number | null }[]; notes: { title: string }[]; spend: { totalUsd: number; includesEstimates: boolean }; budget: number | null; at?: number }) {
  const at = p.at ?? Date.now();
  const open = p.tasks.filter((t) => !t.done), done = p.tasks.length - open.length;
  const overdue = open.filter((t) => t.due_at !== null && t.due_at < at);
  return [
    `# Informe del proyecto: ${p.name}`, `Fecha: ${new Date(at).toLocaleDateString()}`, "",
    "## Tareas", `Completadas: ${done} de ${p.tasks.length}. Vencidas: ${overdue.length}.`, ...open.slice(0, 30).map((t) => `- [ ] ${t.title}${t.due_at ? ` (vence ${new Date(t.due_at).toLocaleDateString()})` : ""}`), "",
    "## Notas", ...(p.notes.length ? p.notes.slice(0, 30).map((n) => `- ${n.title}`) : ["Sin notas."]), "",
    "## Gasto del mes", `US$ ${p.spend.totalUsd.toFixed(2)}${p.spend.includesEstimates ? " (incluye estimados)" : ""}${p.budget ? ` de un presupuesto de US$ ${p.budget.toFixed(2)}` : " (sin presupuesto)"}.`,
  ].join("\n");
}
