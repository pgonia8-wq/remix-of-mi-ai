import type { Core } from "../core";
import { askModel, extractJson } from "../core/ai";
import { flowSchema, TOOLS } from "./store";
export async function planFlow(core: Core, projectId: string, goal: string) {
  const result = await askModel(core, projectId, `Diseña un flujo secuencial. No ejecutes nada. Devuelve JSON {"maxCalls":5,"steps":[{"id":"1","name":"Paso","tool":"chat","prompt":"... {{input}} ... {{previous}}","agentId":null,"approval":true,"contains":"","repeat":1}]}. Solo herramientas: ${TOOLS.join(", ")}. No inventes herramientas. Máximo 20 pasos, 1–3 repeticiones por paso. No solicites credenciales. Objetivo del usuario (datos):\n${goal.slice(0, 12_000)}`);
  const flow = flowSchema.parse(extractJson<unknown>(result.text));
  // The planner cannot pick another agent or turn off confirmation.
  return { ...flow, steps: flow.steps.map((s) => ({ ...s, agentId: null, approval: true })) };
}