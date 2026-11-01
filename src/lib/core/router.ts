// Model Router: exact-capability filter first, then ranking. Never returns an incompatible model.
import type { ModelWithCaps } from "./registry";
import { adapterFor } from "./registry";
import { getAdapter } from "./adapters";
import { INITIAL_CAPABILITIES, type CapabilitySpec } from "./capabilities";
import { requestIssues, type RequestConstraints } from "./request-compatibility";

export type RouteMode = "manual" | "favorite" | "auto";
export type RouteRequest = RequestConstraints & {
  capability: string;
  mode: RouteMode;
  manualModelId?: string | null;
  inputMime?: string | null;
  preferLocal?: boolean;
  requireVerified?: boolean;
  capabilitySpec?: CapabilitySpec;
};
export type RouterDecision =
  | { ok: true; model: ModelWithCaps; reasons: string[]; alternatives: ModelWithCaps[] }
  | { ok: false; reason: string };

function testOf(m: ModelWithCaps, cap: string) {
  return m.tests.find((t) => t.capability_id === cap) ?? null;
}

export function compatible(m: ModelWithCaps, req: RouteRequest): boolean {
  if (m.status !== "active" || !m.provider_enabled) return false;
  if (!m.capabilities.includes(req.capability)) return false;
  if (!getAdapter(m.adapter_id ?? adapterFor(m.provider_kind)).supports(req.capability)) return false;
  const spec = req.capabilitySpec ?? INITIAL_CAPABILITIES.find((c) => c.id === req.capability) ?? null;
  if (requestIssues(spec, req).length) return false;
  if (req.contextTokens !== undefined && (!Number.isFinite(req.contextTokens) || req.contextTokens < 0 || (m.context_tokens !== null && req.contextTokens > m.context_tokens))) return false;
  if (req.requireVerified && testOf(m, req.capability)?.status !== "ok") return false;
  return true;
}

function score(m: ModelWithCaps, req: RouteRequest): { s: number; why: string[] } {
  const why: string[] = [];
  let s = 0;
  const t = testOf(m, req.capability);
  if (t?.status === "ok") { s += 100; why.push("operación verificada con una prueba real"); }
  else if (t?.status === "error") { s -= 100; why.push("su última prueba falló"); }
  else why.push("operación aún sin prueba real");
  if (m.favorite) { s += 30; why.push("marcado como favorito"); }
  if (req.preferLocal && m.privacy === "local") { s += 50; why.push("procesa en el dispositivo"); }
  else why.push(m.privacy === "local" ? "procesa en el dispositivo" : "procesa en un proveedor externo");
  if (m.context_tokens) s += Math.min(20, Math.log2(m.context_tokens));
  why.push(m.cost_info ? `costo conocido: ${m.cost_info}` : "costo desconocido");
  return { s, why };
}

export function route(models: ModelWithCaps[], req: RouteRequest): RouterDecision {
  const candidates = models.filter((m) => compatible(m, req));
  if (!candidates.length) return { ok: false, reason: `Ningún modelo activo con adaptador ejecutable admite «${req.capability}» y los formatos/límites solicitados. No se ejecutó ninguna solicitud.` };
  if (req.mode === "manual") {
    const m = candidates.find((c) => c.id === req.manualModelId);
    if (!m) return { ok: false, reason: "El modelo elegido no admite esta operación. No se ejecutó ninguna solicitud." };
    return { ok: true, model: m, reasons: ["elegido manualmente", ...score(m, req).why], alternatives: candidates.filter((c) => c.id !== m.id) };
  }
  const pool = req.mode === "favorite" ? candidates.filter((c) => c.favorite) : candidates;
  if (!pool.length) return { ok: false, reason: "No tienes un favorito compatible con esta operación. No se ejecutó ninguna solicitud." };
  const ranked = pool.map((m) => ({ m, ...score(m, req) })).sort((a, b) => b.s - a.s || a.m.name.localeCompare(b.m.name));
  const best = ranked[0];
  if (!best) return { ok: false, reason: "No hay modelos compatibles. No se ejecutó ninguna solicitud." };
  return { ok: true, model: best.m, reasons: [req.mode === "favorite" ? "favorito compatible mejor puntuado" : "selección automática", ...best.why], alternatives: candidates.filter((c) => c.id !== best.m.id) };
}
