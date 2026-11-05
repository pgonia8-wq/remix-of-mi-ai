// @vitest-environment node
// Controlled model catalog; no real provider requests or quota validation.
import { describe, expect, it } from "vitest";
import { assignRoleModels } from "@/lib/automation/role-models";
import { validatePlan } from "@/lib/automation/orchestrator";
import type { ModelWithCaps } from "@/lib/core/registry";
const m = (id: string, remote = id): ModelWithCaps => ({ id, provider_id: "azure-resource", remote_id: remote, name: id, status: "active", source: "manual", favorite: 0, cost_info: null, privacy: "external", context_tokens: 100000, updated_at: 0, capabilities: ["chat"], provider_kind: "azure_openai", provider_name: "Azure", provider_enabled: 1, tests: [] });
const catalog = [m("gpt"), m("qwen"), m("kimi"), m("deepseek")];
describe("Modelos independientes por rol", () => {
  it("un coordinador pequeño deja el modelo avanzado para un especialista", () => {
    const a = assignRoleModels([m("small"), ...catalog], ["coordinator", "analyst"], {}, { coordinator: "small", analyst: "gpt" });
    expect(a['coordinator']?.modelId).toBe("small");
    expect(a['analyst']?.modelId).toBe("gpt");
  });
  it("un modelo solo tiene un rol", () => {
    const a = assignRoleModels(catalog, ["coordinator", "analyst", "auditor"]);
    expect(new Set(Object.values(a).map((v) => v.key)).size).toBe(3);
  });
  it("respeta el modelo avanzado elegido para coordinar", () => {
    expect(assignRoleModels(catalog, ["coordinator", "analyst"], {}, { coordinator: "gpt" })['coordinator']?.modelId).toBe("gpt");
  });
  it("no reutiliza deployments registrados dos veces", () => {
    expect(() => assignRoleModels([m("a", "same"), m("b", "same")], ["coordinator", "auditor"])).toThrow(/Faltan modelos/);
  });
  it("rechaza selecciones manuales repetidas", () => {
    expect(() => assignRoleModels(catalog, [], {}, { coordinator: "gpt", auditor: "gpt" })).toThrow(/varios roles/);
  });
  it("si faltan modelos detiene la asignación", () => {
    expect(() => assignRoleModels([m("gpt")], ["coordinator", "analyst"])).toThrow(/Faltan modelos/);
  });
  it("conserva las reservas al replanificar sin tomar modelos ocupados", () => {
    const a = assignRoleModels(catalog, ["coordinator", "auditor"]);
    const b = assignRoleModels(catalog, ["debugger"], a);
    expect(b['coordinator']).toEqual(a['coordinator']);
    expect(b['auditor']).toEqual(a['auditor']);
    expect(new Set(Object.values(b).map((v) => v.key)).size).toBe(3);
  });
  it("acepta Investigador como analista sin ampliar permisos", () => {
    const p = validatePlan({ tasks: [{ id: "t1", title: "Investigación", role: "Investigador", contract: "Fuentes", tools: [] }] });
    expect(p.tasks[0]?.role).toBe("analyst");
  });
  it("acepta la distribución explícita propuesta por el coordinador", () => {
    const p = validatePlan({ tasks: [{ id: "t1", title: "Investigar", role: "analyst", contract: "Fuentes" }], assignments: { analyst: "kimi" } });
    expect(assignRoleModels(catalog, ["analyst"], {}, p.assignments)['analyst']?.modelId).toBe("kimi");
  });
});
