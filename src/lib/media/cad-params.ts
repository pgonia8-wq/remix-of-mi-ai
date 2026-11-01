// Parametric CAD: named parameters with formulas, and per-dimension formulas on features.
// A small recursive-descent parser evaluates arithmetic only (no eval, no host objects).
export type CadParam = { name: string; expr: string };
const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: (d) => Math.sin(d * Math.PI / 180), cos: (d) => Math.cos(d * Math.PI / 180), tan: (d) => Math.tan(d * Math.PI / 180),
};
const CONSTS: Record<string, number> = { pi: Math.PI };
export const PARAM_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };
function lex(src: string): Tok[] {
  if (src.length > 300) throw new Error("Fórmula demasiado larga.");
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: "id", v: id[0] }); i += id[0].length; continue; }
    if ("+-*/^(),%".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`Carácter no permitido en fórmula: "${c}"`);
  }
  return out;
}
/** Collects identifiers referenced by a formula (excluding functions/constants). */
export function formulaRefs(src: string): string[] {
  const toks = lex(src), refs = new Set<string>();
  toks.forEach((t, i) => { if (t.t === "id" && !(t.v in CONSTS) && !(toks[i + 1]?.t === "op" && toks[i + 1]?.v === "(")) refs.add(t.v); });
  return [...refs];
}
export function evalFormula(src: string, vars: Record<string, number>): number {
  const toks = lex(src); let p = 0;
  const peek = () => toks[p], take = () => toks[p++];
  const expect = (v: string) => { const t = take(); if (!t || t.t !== "op" || t.v !== v) throw new Error(`Se esperaba "${v}" en la fórmula.`); };
  function expr(): number { let v = term(); for (let t = peek(); t?.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) { take(); v = t.v === "+" ? v + term() : v - term(); } return v; }
  function term(): number { let v = power(); for (let t = peek(); t?.t === "op" && "*/%".includes(t.v); t = peek()) { take(); const r = power(); v = t.v === "*" ? v * r : t.v === "/" ? v / r : v % r; } return v; }
  function power(): number { const b = unary(); const t = peek(); if (t?.t === "op" && t.v === "^") { take(); return b ** power(); } return b; }
  function unary(): number { const t = peek(); if (t?.t === "op" && (t.v === "-" || t.v === "+")) { take(); const v = unary(); return t.v === "-" ? -v : v; } return atom(); }
  function atom(): number {
    const t = take(); if (!t) throw new Error("Fórmula incompleta.");
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "(") { const v = expr(); expect(")"); return v; }
    if (t.t === "id") {
      const n = peek();
      if (n?.t === "op" && n.v === "(") {
        const f = FUNCS[t.v]; if (!f) throw new Error(`Función desconocida: ${t.v}`);
        take(); const args: number[] = [];
        if (!(peek()?.t === "op" && peek()?.v === ")")) { args.push(expr()); while (peek()?.t === "op" && peek()?.v === ",") { take(); args.push(expr()); } }
        expect(")"); return f(...args);
      }
      if (t.v in CONSTS) return CONSTS[t.v]!;
      if (!(t.v in vars)) throw new Error(`Parámetro desconocido: ${t.v}`);
      return vars[t.v]!;
    }
    throw new Error("Fórmula inválida.");
  }
  const v = expr(); if (p !== toks.length) throw new Error("Fórmula inválida: sobran símbolos.");
  if (!Number.isFinite(v)) throw new Error("La fórmula no da un número finito.");
  return v;
}
/** Resolves parameters in dependency order; rejects duplicates, unknown names and cycles. */
export function resolveParams(params: CadParam[] = []): Record<string, number> {
  if (params.length > 64) throw new Error("Máximo 64 parámetros.");
  const byName = new Map<string, CadParam>();
  for (const p of params) { if (!PARAM_NAME.test(p.name) || p.name in FUNCS || p.name in CONSTS) throw new Error(`Nombre de parámetro inválido: ${p.name}`); if (byName.has(p.name)) throw new Error(`Parámetro duplicado: ${p.name}`); byName.set(p.name, p); }
  const values: Record<string, number> = {}, visiting = new Set<string>();
  const visit = (name: string): number => {
    if (name in values) return values[name]!;
    const p = byName.get(name); if (!p) throw new Error(`Parámetro desconocido: ${name}`);
    if (visiting.has(name)) throw new Error(`Restricción circular en el parámetro ${name}.`);
    visiting.add(name);
    for (const r of formulaRefs(p.expr)) visit(r);
    visiting.delete(name);
    return (values[name] = evalFormula(p.expr, values));
  };
  for (const p of params) visit(p.name);
  return values;
}
