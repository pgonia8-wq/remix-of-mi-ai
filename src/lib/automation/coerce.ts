// Lenient repair of model-produced tool arguments, applied only after strict validation fails.
// Models (DeepSeek, Qwen, Kimi, GPT…) often send null for optional fields, numbers as strings, a single value
// instead of a list, extra keys, or paths starting with "/" or "./". The repaired value is validated again with
// the same strict schema, so nothing outside the schema is ever accepted.
import type { ZodTypeAny } from "zod";

const PATH_KEYS = new Set(["path", "from", "to", "into", "dir", "paths", "file", "files"]);
const typeName = (s: unknown) => (s as { _def?: { typeName?: string } })?._def?.typeName;
const def = (s: unknown) => (s as { _def: Record<string, unknown> })._def;

function unwrap(s: unknown): unknown {
  let cur = s;
  for (let i = 0; i < 10; i++) {
    const t = typeName(cur);
    if (t === "ZodOptional" || t === "ZodDefault" || t === "ZodNullable") cur = def(cur)["innerType"];
    else if (t === "ZodEffects") cur = def(cur)["schema"];
    else break;
  }
  return cur;
}
const normPath = (v: string) => v.trim().replace(/^(\.\/)+/, "").replace(/^\/+/, "");

export function coerceArgs(schema: unknown, value: unknown, key = ""): unknown {
  const s = unwrap(schema);
  const t = typeName(s);
  if (value === null) return undefined;
  switch (t) {
    case "ZodObject": {
      if (typeof value === "string") { try { return coerceArgs(schema, JSON.parse(value), key); } catch { return value; } }
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const shape = (typeof def(s)["shape"] === "function" ? (def(s)["shape"] as () => Record<string, unknown>)() : def(s)["shape"]) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!(k in shape)) continue; // unknown keys would fail .strict()
        const c = coerceArgs(shape[k], v, k);
        if (c !== undefined) out[k] = c;
      }
      return out;
    }
    case "ZodArray": {
      const list = Array.isArray(value) ? value : typeof value === "string" && value.trim().startsWith("[") ? (() => { try { return JSON.parse(value); } catch { return [value]; } })() : [value];
      return (Array.isArray(list) ? list : [list]).map((v) => coerceArgs(def(s)["type"], v, key)).filter((v) => v !== undefined);
    }
    case "ZodRecord": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, coerceArgs(def(s)["valueType"], v, k)]).filter(([, v]) => v !== undefined));
    }
    case "ZodString":
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      if (typeof value === "string" && PATH_KEYS.has(key)) return normPath(value);
      return value;
    case "ZodNumber":
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
      return value;
    case "ZodBoolean":
      if (value === "true" || value === 1 || value === "1") return true;
      if (value === "false" || value === 0 || value === "0") return false;
      return value;
    case "ZodEnum": {
      if (typeof value !== "string") return value;
      const values = def(s)["values"] as string[];
      return values.find((v) => v.toLowerCase() === value.trim().toLowerCase()) ?? value;
    }
    default:
      return value;
  }
}

/** Validation message the model can act on: which field, what went wrong, and the expected shape. */
export function describeIssue(schema: ZodTypeAny, error: { issues: { path: (string | number)[]; message: string }[] }, jsonSchema?: unknown): string {
  const issues = error.issues.slice(0, 3).map((i) => `${i.path.length ? `«${i.path.join(".")}»` : "entrada"}: ${i.message}`).join("; ");
  const shape = jsonSchema ? ` Formato esperado: ${JSON.stringify(jsonSchema).slice(0, 1200)}` : "";
  return `Entrada inválida (${issues}).${shape} Corrige los argumentos y vuelve a llamar la herramienta.`;
}
