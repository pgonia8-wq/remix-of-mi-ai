export type DataTable = { name: string; headers: string[]; rows: unknown[][] };
export type ColumnStats = { column: string; count: number; missing: number; min: number; max: number; sum: number; mean: number; median: number; std: number; anomalies: number[] };
export function analyzeColumn(t: DataTable, index: number): ColumnStats {
  const valid = t.rows.map((r, i) => ({ value: typeof r[index] === "number" ? r[index] as number : typeof r[index] === "string" && String(r[index]).trim() ? Number(r[index]) : NaN, row: i })).filter((x) => Number.isFinite(x.value));
  if (!valid.length) throw new Error("La columna no tiene datos numéricos.");
  const values = valid.map((x) => x.value).sort((a, b) => a - b), count = values.length;
  const sum = values.reduce((s, v) => s + v, 0), mean = sum / count;
  const lo = values[Math.floor((count - 1) / 2)], hi = values[Math.ceil((count - 1) / 2)];
  if (lo === undefined || hi === undefined) throw new Error("Sin datos");
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / count);
  return { column: t.headers[index] ?? "Columna", count, missing: t.rows.length - count, min: values[0] ?? 0, max: values[count - 1] ?? 0, sum, mean, median: (lo + hi) / 2, std, anomalies: std === 0 ? [] : valid.filter((x) => Math.abs(x.value - mean) > 3 * std).map((x) => x.row) };
}
export async function readTables(bytes: Uint8Array): Promise<DataTable[]> {
  if (bytes.length > 10 * 1024 * 1024) throw new Error("Máximo 10 MB para análisis local.");
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array", sheetRows: 10002 });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name]; if (!sheet) throw new Error("Hoja no válida");
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
    if (data.length > 10001) throw new Error("Máximo 10 000 filas por hoja.");
    const [header, ...rows] = data;
    return { name, headers: (header ?? []).map((x, i) => String(x ?? `Columna ${i + 1}`)), rows };
  });
}
export function costScenario(units: number, price: number, variable: number, fixed: number) {
  if (![units, price, variable, fixed].every((x) => Number.isFinite(x) && x >= 0)) throw new Error("Usa valores positivos o cero.");
  return { revenue: units * price, costs: units * variable + fixed, profit: units * (price - variable) - fixed, breakEven: price > variable ? fixed / (price - variable) : null };
}