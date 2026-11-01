import { expect, it } from "vitest";
import { evalFormula, resolveParams } from "@/lib/media/cad-params";
import { newFeature, cadMetrics, exportCad, type CadDocument } from "@/lib/media/cad";
import { stepFaceted } from "@/lib/media/step";
import { writeFileSync } from "node:fs";
it("evaluates arithmetic formulas without eval", () => {
  expect(evalFormula("2*(ancho+3)^2/4", { ancho: 1 })).toBe(8);
  expect(evalFormula("max(10, sqrt(144)) - -2", {})).toBe(14);
  expect(evalFormula("cos(60)*10", {})).toBeCloseTo(5);
  expect(() => evalFormula("alert(1)", {})).toThrow(/desconocida/);
  expect(() => evalFormula("constructor", {})).toThrow(/desconocido/);
  expect(() => evalFormula("1;2", {})).toThrow();
});
it("resolves parameter constraints in dependency order and rejects cycles", () => {
  expect(resolveParams([{ name: "alto", expr: "ancho*2" }, { name: "ancho", expr: "15" }])).toEqual({ alto: 30, ancho: 15 });
  expect(() => resolveParams([{ name: "a", expr: "b+1" }, { name: "b", expr: "a" }])).toThrow(/circular/);
  expect(() => resolveParams([{ name: "a", expr: "1" }, { name: "a", expr: "2" }])).toThrow(/duplicado/);
});
it("feature dimensions follow parameter changes", () => {
  const box = { ...newFeature("box"), exprs: { "size.0": "lado", "size.1": "lado", "size.2": "lado/2" } };
  const doc: CadDocument = { version: 1, unit: "mm", name: "P", features: [box], params: [{ name: "lado", expr: "10" }] };
  expect(cadMetrics(doc).volumeMm3).toBeCloseTo(500);
  expect(cadMetrics({ ...doc, params: [{ name: "lado", expr: "20" }] }).volumeMm3).toBeCloseTo(4000);
});
it("exports a structurally valid faceted STEP with all references defined", async () => {
  const a = newFeature("box"), b = { ...newFeature("cylinder"), size: [10, 10, 40] as [number, number, number] };
  const cut = { ...newFeature("subtract"), refs: [a.id, b.id] };
  const doc: CadDocument = { version: 1, unit: "mm", name: "Pieza's", features: [{ ...a, visible: false }, { ...b, visible: false }, cut] };
  const text = new TextDecoder().decode(await exportCad(doc, "step"));
  writeFileSync("/tmp/miai-test.step", text);
  expect(text.startsWith("ISO-10303-21;")).toBe(true);
  expect(text).toContain("FACETED_BREP(");
  expect(text).toContain("SI_UNIT(.MILLI.,.METRE.)");
  const defined = new Set([...text.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  const used = new Set([...text.matchAll(/#(\d+)(?!=)/g)].map((m) => m[1]));
  for (const u of used) expect(defined.has(u)).toBe(true);
  expect(text).toContain("'Pieza''s'");
  expect(() => stepFaceted("x", [])).toThrow();
});
