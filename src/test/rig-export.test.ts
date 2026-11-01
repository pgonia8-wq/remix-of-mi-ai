import { expect, it } from "vitest";
import { autoAssign, meshFromPolygons, setKey } from "@/lib/media/rig";
import { exportRiggedGlb } from "@/lib/media/rig-export";
it("exports a skinned, animated GLB 2.0 with one joint per bone", async () => {
  const quad = (y0: number, y1: number): [number, number, number][][] => [[[0, y0, 0], [1, y0, 0], [1, y1, 0]], [[0, y0, 0], [1, y1, 0], [0, y1, 0]]];
  let d = autoAssign({ ...meshFromPolygons("Brazo", [[...quad(0, 10), ...quad(10, 20)]]), bones: [{ id: "a", name: "hombro", parent: null, head: [0, 0, 0] }, { id: "b", name: "codo", parent: "a", head: [0, 10, 0] }] });
  d = setKey(setKey(d, "b", { t: 0, rot: [0, 0, 0], move: [0, 0, 0] }), "b", { t: 2, rot: [0, 0, 90], move: [0, 0, 0] });
  const glb = await exportRiggedGlb(d), view = new DataView(glb.buffer, glb.byteOffset);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
  expect(view.getUint32(4, true)).toBe(2);
  const jsonLen = view.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)));
  expect(json.skins[0].joints.length).toBe(2);
  expect(json.animations[0].channels.map((c: { target: { path: string } }) => c.target.path).sort()).toEqual(["rotation", "translation"]);
});
