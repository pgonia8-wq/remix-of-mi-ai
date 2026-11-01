import { expect, it } from "vitest";
import { autoAssign, meshFromPolygons, moveVertices, posedPositions, sampleKeys, setKey, validateMesh, verticesWithin, type MeshDoc } from "@/lib/media/rig";
const quad = (y0: number, y1: number): [number, number, number][][] => [[[0, y0, 0], [1, y0, 0], [1, y1, 0]], [[0, y0, 0], [1, y1, 0], [0, y1, 0]]];
function arm(): MeshDoc {
  const d = meshFromPolygons("Brazo", [[...quad(0, 10), ...quad(10, 20)]]);
  return autoAssign({ ...d, bones: [{ id: "a", name: "hombro", parent: null, head: [0, 0, 0] }, { id: "b", name: "codo", parent: "a", head: [0, 10, 0] }, { id: "c", name: "punta", parent: "b", head: [0, 20, 0] }] });
}
it("welds polygons into an indexed mesh", () => {
  const d = meshFromPolygons("Q", [quad(0, 1)]);
  expect(d.positions.length / 3).toBe(4); expect(d.indices.length).toBe(6); validateMesh(d);
});
it("child bone rotation moves only its vertices around its pivot (glTF convention)", () => {
  let d = arm();
  const tip = d.positions.findIndex((_, i) => i % 3 === 1 && d.positions[i] === 20 && d.positions[i - 1] === 0) / 3 | 0;
  d = setKey(d, "b", { t: 1, rot: [0, 0, 90], move: [0, 0, 0] });
  const p = posedPositions(d, 1);
  expect(p[tip * 3]).toBeCloseTo(-10); expect(p[tip * 3 + 1]).toBeCloseTo(10);
  const base = d.positions.findIndex((v, i) => i % 3 === 0 && v === 1 && d.positions[i + 1] === 0) / 3;
  expect(p[base * 3]).toBeCloseTo(1); expect(p[base * 3 + 1]).toBeCloseTo(0);
});
it("parent rotation propagates to children", () => {
  const d = setKey(arm(), "a", { t: 0, rot: [0, 0, 180], move: [0, 0, 0] }), p = posedPositions(d, 0);
  const i = d.positions.findIndex((v, k) => k % 3 === 1 && v === 20) / 3;
  expect(p[i * 3 + 1]).toBeCloseTo(-20);
});
it("interpolates keyframes linearly and clamps outside the range", () => {
  const keys = [{ t: 0, rot: [0, 0, 0] as [number, number, number], move: [0, 0, 0] as [number, number, number] }, { t: 2, rot: [0, 90, 0] as [number, number, number], move: [4, 0, 0] as [number, number, number] }];
  expect(sampleKeys(keys, 1).rot[1]).toBeCloseTo(45); expect(sampleKeys(keys, 1).move[0]).toBeCloseTo(2); expect(sampleKeys(keys, 5).rot[1]).toBe(90);
});
it("vertex editing with soft falloff moves the center fully and the edge partially", () => {
  const d = meshFromPolygons("Q", [quad(0, 10)]), ids = verticesWithin(d, [0, 0, 0], 20);
  const m = moveVertices(d, ids, [0, 0, 5], { center: [0, 0, 0], radius: 20 });
  const origin = d.positions.findIndex((v, i) => i % 3 === 0 && v === 0 && d.positions[i + 1] === 0) / 3;
  expect(m.positions[origin * 3 + 2]).toBeCloseTo(5);
  expect(Math.max(...ids.map((i) => m.positions[i * 3 + 2]!))).toBeCloseTo(5);
  expect(Math.min(...ids.map((i) => m.positions[i * 3 + 2]!))).toBeLessThan(5);
});
it("rejects cyclic bone hierarchies and invalid keyframes", () => {
  const d = arm();
  expect(() => validateMesh({ ...d, bones: [{ id: "a", name: "x", parent: "b", head: [0, 0, 0] }, { id: "b", name: "y", parent: "a", head: [0, 1, 0] }], weights: d.weights.map(() => 0) })).toThrow(/circular/);
  expect(() => validateMesh(setKey(d, "a", { t: 99, rot: [0, 0, 0], move: [0, 0, 0] }))).toThrow(/Keyframe/);
});
