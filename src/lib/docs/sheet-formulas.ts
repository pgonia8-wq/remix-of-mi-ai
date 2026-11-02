// Spreadsheet formula engine: references, ranges, operators and common functions (English and Spanish names).
// Every change recalculates dependent cells; cycles become #CIRC! instead of hanging. Pure and unit-tested.
export type CellError = { error: "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#CIRC!" | "#N/A" | "#NUM!" };
export type Value = number | string | boolean | CellError | null;
export type Cells = Record<string, string>;

const err = (e: CellError["error"]): CellError => ({ error: e });
export const isErr = (v: unknown): v is CellError => typeof v === "object" && v !== null && "error" in v;

// ---------- addresses ----------
export function colToNum(c: string) { let n = 0; for (const ch of c.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
export function numToCol(n: number) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
export function parseAddr(a: string): { col: number; row: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})$/.exec(a); if (!m) return null;
  return { col: colToNum(m[1]!), row: Number(m[2]) };
}
export const addr = (col: number, row: number) => `${numToCol(col)}${row}`;
const norm = (a: string) => { const p = parseAddr(a); return p ? addr(p.col, p.row) : a.toUpperCase(); };

// ---------- tokenizer ----------
type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "ref"; v: string } | { t: "range"; a: string; b: string } | { t: "fn"; v: string } | { t: "op"; v: string } | { t: "bool"; v: boolean } | { t: "("  } | { t: ")" } | { t: "," };
function tokenize(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') { let s = ""; i++; while (i < src.length) { if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } break; } s += src[i++]; } if (src[i] !== '"') throw new Error("#VALUE!"); i++; out.push({ t: "str", v: s }); continue; }
    const num = /^(\d+(?:[.]\d+)?(?:[eE][+-]?\d+)?|[.]\d+)/.exec(src.slice(i));
    if (num && !/[A-Za-z]/.test(src[i - 1] ?? "")) { out.push({ t: "num", v: Number(num[1]) }); i += num[1]!.length; continue; }
    const range = /^(\$?[A-Za-z]{1,3}\$?\d{1,6}):(\$?[A-Za-z]{1,3}\$?\d{1,6})/.exec(src.slice(i));
    if (range) { out.push({ t: "range", a: norm(range[1]!), b: norm(range[2]!) }); i += range[0].length; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (word) {
      const w = word[0]; i += w.length;
      if (src[i] === "(") { out.push({ t: "fn", v: w.toUpperCase() }); continue; }
      const up = w.toUpperCase();
      if (up === "TRUE" || up === "VERDADERO") { out.push({ t: "bool", v: true }); continue; }
      if (up === "FALSE" || up === "FALSO") { out.push({ t: "bool", v: false }); continue; }
      if (parseAddr(w.replace(/\$/g, ""))) { out.push({ t: "ref", v: norm(w) }); continue; }
      throw new Error("#NAME?");
    }
    if (c === "$") { const r = /^\$?[A-Za-z]{1,3}\$?\d{1,6}/.exec(src.slice(i)); if (r) { const rest = src.slice(i + r[0].length); if (rest.startsWith(":")) { const r2 = /^:(\$?[A-Za-z]{1,3}\$?\d{1,6})/.exec(rest); if (r2) { out.push({ t: "range", a: norm(r[0]), b: norm(r2[1]!) }); i += r[0].length + r2[0].length; continue; } } out.push({ t: "ref", v: norm(r[0]) }); i += r[0].length; continue; } }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^&=<>%".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { out.push({ t: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")" }); i++; continue; }
    if (c === "," || c === ";") { out.push({ t: "," }); i++; continue; }
    throw new Error("#VALUE!");
  }
  return out;
}

// ---------- parser (precedence climbing) ----------
type Node = { k: "num"; v: number } | { k: "str"; v: string } | { k: "bool"; v: boolean } | { k: "ref"; v: string } | { k: "range"; a: string; b: string }
  | { k: "un"; op: string; x: Node } | { k: "bin"; op: string; a: Node; b: Node } | { k: "fn"; name: string; args: Node[] } | { k: "pct"; x: Node };
const PREC: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };
function parse(tokens: Tok[]): Node {
  let p = 0;
  const peek = () => tokens[p];
  const primary = (): Node => {
    const t = tokens[p++]; if (!t) throw new Error("#VALUE!");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "bool") return { k: "bool", v: t.v };
    if (t.t === "ref") return { k: "ref", v: t.v };
    if (t.t === "range") return { k: "range", a: t.a, b: t.b };
    if (t.t === "op" && (t.v === "-" || t.v === "+")) return { k: "un", op: t.v, x: expr(6) }; // Excel: -2^2 = 4
    if (t.t === "(") { const e = expr(0); if (tokens[p++]?.t !== ")") throw new Error("#VALUE!"); return e; }
    if (t.t === "fn") {
      p++; const args: Node[] = [];
      if (peek()?.t !== ")") { for (;;) { args.push(expr(0)); if (peek()?.t === ",") { p++; continue; } break; } }
      if (tokens[p++]?.t !== ")") throw new Error("#VALUE!");
      return { k: "fn", name: t.v, args };
    }
    throw new Error("#VALUE!");
  };
  const expr = (min: number): Node => {
    let left = primary();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && t.v === "%") { p++; left = { k: "pct", x: left }; continue; }
      if (!t || t.t !== "op" || PREC[t.v] === undefined || PREC[t.v]! < min) break;
      p++; const prec = PREC[t.v]!;
      const right = expr(t.v === "^" ? prec : prec + 0.1);
      left = { k: "bin", op: t.v, a: left, b: right };
    }
    return left;
  };
  const n = expr(0); if (p !== tokens.length) throw new Error("#VALUE!");
  return n;
}

// ---------- evaluation ----------
type Flat = Value[];
const toNum = (v: Value): number | CellError => {
  if (isErr(v)) return v; if (v === null || v === "") return 0; if (typeof v === "boolean") return v ? 1 : 0; if (typeof v === "number") return v;
  const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : err("#VALUE!");
};
const toStr = (v: Value): string | CellError => isErr(v) ? v : v === null ? "" : typeof v === "boolean" ? (v ? "VERDADERO" : "FALSO") : typeof v === "number" ? String(Math.round(v * 1e12) / 1e12) : v;
const toBool = (v: Value): boolean | CellError => { if (isErr(v)) return v; if (typeof v === "boolean") return v; if (typeof v === "number") return v !== 0; if (v === null || v === "") return false; const u = String(v).toUpperCase(); if (u === "TRUE" || u === "VERDADERO") return true; if (u === "FALSE" || u === "FALSO") return false; return err("#VALUE!"); };
const nums = (vals: Flat) => vals.filter((v): v is number => typeof v === "number");
const firstErr = (vals: Flat) => vals.find(isErr) as CellError | undefined;
function criteria(c: Value): (v: Value) => boolean {
  const s = toStr(c); if (isErr(s)) return () => false;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s)!; const op = m[1] ?? "=", rhs = m[2]!; const n = Number(rhs);
  return (v) => {
    if (rhs !== "" && Number.isFinite(n) && typeof v === "number") { switch (op) { case "<": return v < n; case ">": return v > n; case "<=": return v <= n; case ">=": return v >= n; case "<>": return v !== n; default: return v === n; } }
    const vs = (toStr(v) as string).toLowerCase(), r = rhs.toLowerCase();
    if (op === "<>") return vs !== r;
    if (op === "=") return r.includes("*") ? new RegExp(`^${r.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(vs) : vs === r;
    return false;
  };
}

const ALIAS: Record<string, string> = { SUMA: "SUM", PROMEDIO: "AVERAGE", CONTAR: "COUNT", CONTARA: "COUNTA", SI: "IF", REDONDEAR: "ROUND", Y: "AND", O: "OR", NO: "NOT", CONCATENAR: "CONCAT", LARGO: "LEN", MAYUSC: "UPPER", MINUSC: "LOWER", RAIZ: "SQRT", POTENCIA: "POWER", PRODUCTO: "PRODUCT", "SI.ERROR": "IFERROR", "SUMAR.SI": "SUMIF", "CONTAR.SI": "COUNTIF", BUSCARV: "VLOOKUP", MEDIANA: "MEDIAN", ENTERO: "INT", RESIDUO: "MOD", HOY: "TODAY", IZQUIERDA: "LEFT", DERECHA: "RIGHT", "PROMEDIO.SI": "AVERAGEIF", ABS: "ABS", MIN: "MIN", MAX: "MAX", PI: "PI" };

export function evaluateSheet(cells: Cells, opts: { today?: () => string } = {}): Record<string, Value> {
  const raw: Cells = {}; for (const [k, v] of Object.entries(cells)) raw[norm(k)] = v;
  const memo = new Map<string, Value>(), visiting = new Set<string>(), ast = new Map<string, Node | CellError>();
  const cell = (a: string): Value => {
    if (memo.has(a)) return memo.get(a)!;
    if (visiting.has(a)) return err("#CIRC!");
    const src = raw[a];
    if (src === undefined || src === "") return null;
    if (!src.startsWith("=")) { const n = Number(src.replace(/^\s+|\s+$/g, "")); const v: Value = src.trim() !== "" && Number.isFinite(n) && /^-?[\d.]+(e[+-]?\d+)?$/i.test(src.trim()) ? n : /^(true|verdadero)$/i.test(src) ? true : /^(false|falso)$/i.test(src) ? false : src; memo.set(a, v); return v; }
    visiting.add(a);
    let node = ast.get(a);
    if (!node) { try { node = parse(tokenize(src.slice(1))); } catch (e) { node = err(((e as Error).message as CellError["error"]) || "#VALUE!"); } ast.set(a, node); }
    const v = isErr(node) ? node : ev(node);
    visiting.delete(a);
    const out: Value = typeof v === "number" && !Number.isFinite(v) ? err("#NUM!") : v;
    memo.set(a, out); return out;
  };
  const range = (a: string, b: string): Value[][] => {
    const A = parseAddr(a), B = parseAddr(b); if (!A || !B) return [[err("#REF!")]];
    const r0 = Math.min(A.row, B.row), r1 = Math.max(A.row, B.row), c0 = Math.min(A.col, B.col), c1 = Math.max(A.col, B.col);
    if ((r1 - r0 + 1) * (c1 - c0 + 1) > 200_000) return [[err("#REF!")]];
    const rows: Value[][] = []; for (let r = r0; r <= r1; r++) { const row: Value[] = []; for (let c = c0; c <= c1; c++) row.push(cell(addr(c, r))); rows.push(row); }
    return rows;
  };
  const flat = (args: Node[]): Flat => args.flatMap((n) => n.k === "range" ? range(n.a, n.b).flat() : [ev(n)]);
  const ev = (n: Node): Value => {
    switch (n.k) {
      case "num": return n.v; case "str": return n.v; case "bool": return n.v;
      case "ref": return cell(n.v) ?? 0;
      case "range": { const r = range(n.a, n.b); return r.length === 1 && r[0]!.length === 1 ? r[0]![0]! : err("#VALUE!"); }
      case "pct": { const x = toNum(ev(n.x)); return isErr(x) ? x : x / 100; }
      case "un": { const x = toNum(ev(n.x)); return isErr(x) ? x : n.op === "-" ? -x : x; }
      case "bin": {
        const a = ev(n.a), b = ev(n.b);
        if (isErr(a)) return a; if (isErr(b)) return b;
        if (n.op === "&") { const s1 = toStr(a), s2 = toStr(b); return isErr(s1) ? s1 : isErr(s2) ? s2 : s1 + s2; }
        if (["=", "<>", "<", ">", "<=", ">="].includes(n.op)) {
          const both = typeof (a ?? 0) === "number" && typeof (b ?? 0) === "number";
          const x = both ? (a ?? 0) as number : String(toStr(a)).toLowerCase(), y = both ? (b ?? 0) as number : String(toStr(b)).toLowerCase();
          switch (n.op) { case "=": return x === y; case "<>": return x !== y; case "<": return x < y; case ">": return x > y; case "<=": return x <= y; default: return x >= y; }
        }
        const x = toNum(a), y = toNum(b); if (isErr(x)) return x; if (isErr(y)) return y;
        switch (n.op) { case "+": return x + y; case "-": return x - y; case "*": return x * y; case "/": return y === 0 ? err("#DIV/0!") : x / y; case "^": return Math.pow(x, y); }
        return err("#VALUE!");
      }
      case "fn": return call(ALIAS[n.name] ?? n.name, n.args);
    }
  };
  const call = (name: string, args: Node[]): Value => {
    const one = (i: number) => (args[i] ? ev(args[i]!) : null);
    const num1 = (i: number) => toNum(one(i));
    switch (name) {
      case "SUM": { const v = flat(args); return firstErr(v) ?? nums(v).reduce((s, x) => s + x, 0); }
      case "PRODUCT": { const v = flat(args); return firstErr(v) ?? nums(v).reduce((s, x) => s * x, 1); }
      case "AVERAGE": { const v = flat(args); const e = firstErr(v); if (e) return e; const ns = nums(v); return ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : err("#DIV/0!"); }
      case "MEDIAN": { const v = flat(args); const e = firstErr(v); if (e) return e; const ns = nums(v).sort((a, b) => a - b); if (!ns.length) return err("#NUM!"); const m = ns.length >> 1; return ns.length % 2 ? ns[m]! : (ns[m - 1]! + ns[m]!) / 2; }
      case "MIN": { const v = flat(args); const e = firstErr(v); if (e) return e; const ns = nums(v); return ns.length ? Math.min(...ns) : 0; }
      case "MAX": { const v = flat(args); const e = firstErr(v); if (e) return e; const ns = nums(v); return ns.length ? Math.max(...ns) : 0; }
      case "COUNT": return nums(flat(args)).length;
      case "COUNTA": return flat(args).filter((v) => v !== null && v !== "").length;
      case "IF": { const c = toBool(one(0)); if (isErr(c)) return c; return c ? (args[1] ? ev(args[1]) : true) : (args[2] ? ev(args[2]) : false); }
      case "IFERROR": { const v = one(0); return isErr(v) ? one(1) : v; }
      case "AND": { const v = flat(args); for (const x of v) { const b = toBool(x); if (isErr(b)) return b; if (!b) return false; } return true; }
      case "OR": { const v = flat(args); for (const x of v) { const b = toBool(x); if (isErr(b)) return b; if (b) return true; } return false; }
      case "NOT": { const b = toBool(one(0)); return isErr(b) ? b : !b; }
      case "ROUND": { const x = num1(0), d = args[1] ? num1(1) : 0; if (isErr(x)) return x; if (isErr(d)) return d; const f = Math.pow(10, d); return Math.round((x + Math.sign(x) * 1e-12) * f) / f; }
      case "INT": { const x = num1(0); return isErr(x) ? x : Math.floor(x); }
      case "MOD": { const x = num1(0), y = num1(1); if (isErr(x)) return x; if (isErr(y)) return y; return y === 0 ? err("#DIV/0!") : x - y * Math.floor(x / y); }
      case "ABS": { const x = num1(0); return isErr(x) ? x : Math.abs(x); }
      case "SQRT": { const x = num1(0); return isErr(x) ? x : x < 0 ? err("#NUM!") : Math.sqrt(x); }
      case "POWER": { const x = num1(0), y = num1(1); if (isErr(x)) return x; if (isErr(y)) return y; return Math.pow(x, y); }
      case "PI": return Math.PI;
      case "CONCAT": { const v = flat(args); const e = firstErr(v); return e ?? v.map((x) => toStr(x) as string).join(""); }
      case "LEN": { const s = toStr(one(0)); return isErr(s) ? s : s.length; }
      case "UPPER": { const s = toStr(one(0)); return isErr(s) ? s : s.toUpperCase(); }
      case "LOWER": { const s = toStr(one(0)); return isErr(s) ? s : s.toLowerCase(); }
      case "LEFT": { const s = toStr(one(0)), n = args[1] ? num1(1) : 1; if (isErr(s)) return s; if (isErr(n)) return n; return s.slice(0, Math.max(0, n)); }
      case "RIGHT": { const s = toStr(one(0)), n = args[1] ? num1(1) : 1; if (isErr(s)) return s; if (isErr(n)) return n; return n <= 0 ? "" : s.slice(-n); }
      case "TODAY": return opts.today ? opts.today() : new Date().toISOString().slice(0, 10);
      case "SUMIF": case "COUNTIF": case "AVERAGEIF": {
        const r = args[0]; if (r?.k !== "range") return err("#VALUE!");
        const test = criteria(one(1)), vals = range(r.a, r.b).flat();
        const sumR = args[2]?.k === "range" ? range((args[2] as { a: string }).a, (args[2] as { b: string }).b).flat() : vals;
        const hits = vals.map((v, i) => (test(v) ? sumR[i] ?? null : undefined)).filter((v) => v !== undefined) as Value[];
        if (name === "COUNTIF") return hits.length;
        const ns = nums(hits); if (name === "SUMIF") return ns.reduce((s, x) => s + x, 0);
        return ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : err("#DIV/0!");
      }
      case "VLOOKUP": {
        const key = one(0), r = args[1]; if (r?.k !== "range") return err("#VALUE!");
        const col = num1(2); if (isErr(col)) return col;
        const approx = args[3] ? toBool(one(3)) : true; if (isErr(approx)) return approx;
        const rows = range(r.a, r.b); if (col < 1 || col > (rows[0]?.length ?? 0)) return err("#REF!");
        if (!approx) { const i = rows.findIndex((row) => String(toStr(row[0] ?? null)).toLowerCase() === String(toStr(key)).toLowerCase() || row[0] === key); return i < 0 ? err("#N/A") : rows[i]![col - 1] ?? null; }
        let best = -1; const k = toNum(key); if (isErr(k)) return err("#N/A");
        rows.forEach((row, i) => { const v = row[0]; if (typeof v === "number" && v <= k) best = i; });
        return best < 0 ? err("#N/A") : rows[best]![col - 1] ?? null;
      }
    }
    return err("#NAME?");
  };
  const out: Record<string, Value> = {};
  for (const a of Object.keys(raw)) out[a] = cell(a);
  return out;
}

export const display = (v: Value) => v === null ? "" : isErr(v) ? v.error : typeof v === "boolean" ? (v ? "VERDADERO" : "FALSO") : typeof v === "number" ? (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0) ? v.toExponential(6) : String(Math.round(v * 1e10) / 1e10)) : v;

// ---------- files ----------
export type Sheet = { name: string; cells: Cells };
export async function readSheetFile(bytes: Uint8Array): Promise<Sheet[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array", cellFormula: true });
  return wb.SheetNames.slice(0, 20).map((name) => {
    const ws = wb.Sheets[name]!, cells: Cells = {};
    for (const [k, c] of Object.entries(ws)) {
      if (k.startsWith("!")) continue; const cell = c as { f?: string; v?: unknown; w?: string };
      if (cell.f) cells[k] = `=${cell.f}`; else if (cell.v !== undefined && cell.v !== null) cells[k] = String(cell.v);
    }
    return { name, cells };
  });
}
/** Writes formulas *and* their computed values, so other apps show results even before recalculating. */
export async function writeSheetFile(sheets: Sheet[], format: "xlsx" | "ods" | "csv"): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const values = evaluateSheet(s.cells), ws: Record<string, unknown> = {};
    let maxC = 1, maxR = 1;
    for (const [k, raw] of Object.entries(s.cells)) {
      const p = parseAddr(k); if (!p || raw === "") continue; maxC = Math.max(maxC, p.col); maxR = Math.max(maxR, p.row);
      const v = values[norm(k)] ?? null;
      const cell: Record<string, unknown> = isErr(v) ? { t: "e", v: 0x0f, w: v.error } : typeof v === "number" ? { t: "n", v } : typeof v === "boolean" ? { t: "b", v } : { t: "s", v: v ?? "" };
      if (raw.startsWith("=")) cell["f"] = raw.slice(1);
      ws[norm(k)] = cell;
    }
    ws["!ref"] = `A1:${addr(maxC, maxR)}`;
    XLSX.utils.book_append_sheet(wb, ws as never, s.name.slice(0, 31) || "Hoja1");
  }
  const out = XLSX.write(wb, { type: "array", bookType: format === "csv" ? "csv" : format });
  return new Uint8Array(out as ArrayBuffer);
}
