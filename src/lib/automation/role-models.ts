import type { ModelWithCaps } from "../core/registry";
import { compatible, route } from "../core/router";

export type RoleModel = { modelId: string; name: string; provider: string; deployment: string; key: string };
export type RoleModels = Record<string, RoleModel>;
export const deploymentKey = (m: ModelWithCaps) => JSON.stringify([m.provider_id, m.remote_id.trim().toLowerCase()]);
export const agentModels = (models: ModelWithCaps[]) => models.filter((m) => compatible(m, { capability: "chat", mode: "auto" }) || compatible(m, { capability: "chat.tools", mode: "auto" }));

/** Reserve explicit choices before automatic routing; never recycle a reserved deployment. */
export function assignRoleModels(models: ModelWithCaps[], roles: string[], saved: RoleModels = {}, manual: Record<string, string> = {}): RoleModels {
  const pool = agentModels(models), result: RoleModels = {}, occupied = new Set<string>();
  const reserve = (role: string, id: string) => {
    const m = pool.find((x) => x.id === id);
    if (!m) throw new Error(`El modelo asignado a «${role}» no está disponible para este trabajo. No se envió una solicitud.`);
    const key = deploymentKey(m);
    if (occupied.has(key)) throw new Error("Un mismo modelo/deployment no puede tener varios roles.");
    occupied.add(key); result[role] = { modelId: m.id, name: m.name, provider: m.provider_name, deployment: m.remote_id, key };
  };
  for (const [role, assignment] of Object.entries(saved)) reserve(role, assignment.modelId);
  for (const [role, id] of Object.entries(manual)) {
    if (!id) continue;
    if (result[role]) { if (result[role].modelId !== id) throw new Error(`El rol «${role}» ya tiene un modelo asignado.`); continue; }
    reserve(role, id);
  }
  for (const role of new Set(roles)) {
    if (result[role]) continue;
    const unused = pool.filter((m) => !occupied.has(deploymentKey(m)));
    // Rank chat models first: tools support alone must not funnel all planning into one deployment.
    const chat = route(unused, { capability: "chat", mode: "auto" });
    const choice = chat.ok ? chat : route(unused, { capability: "chat.tools", mode: "auto" });
    if (!choice.ok) throw new Error(`Faltan modelos distintos para el rol «${role}». Añade otro modelo o ajusta el equipo; no se reutilizará uno ocupado.`);
    reserve(role, choice.model.id);
  }
  return result;
}
