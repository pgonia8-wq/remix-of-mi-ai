// Animated GLB export of a rigged MeshDoc via Three.js GLTFExporter (loaded lazily, browser/WebView only).
import { boneOrder, restLocal, type MeshDoc } from "./rig";
import { validateMesh } from "./rig";

export async function exportRiggedGlb(d: MeshDoc): Promise<Uint8Array> {
  validateMesh(d);
  const [T, { GLTFExporter }] = await Promise.all([import("three"), import("three/addons/exporters/GLTFExporter.js")]);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(d.positions, 3));
  geometry.setIndex(d.indices);
  geometry.computeVertexNormals();
  const material = new T.MeshStandardMaterial({ color: 0x8b7cf6, roughness: 0.5, metalness: 0.1 });
  const root = new T.Group(); root.name = d.name.replace(/[^\w-]/g, "_") || "MIAI";
  if (!d.bones.length) {
    root.add(new T.Mesh(geometry, material));
  } else {
    const n = d.positions.length / 3, skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const w = d.weights[i] ?? -1; skinIndex[i * 4] = Math.max(0, w); skinWeight[i * 4] = 1; }
    geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(skinWeight, 4));
    const bones = new Map<string, InstanceType<typeof T.Bone>>();
    for (const b of boneOrder(d.bones)) { const bone = new T.Bone(); bone.name = b.name; bone.position.fromArray(restLocal(d, b)); bones.set(b.id, bone); (b.parent ? bones.get(b.parent)! : root).add(bone); }
    const ordered = d.bones.map((b) => bones.get(b.id)!), mesh = new T.SkinnedMesh(geometry, material);
    root.add(mesh); root.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton(ordered));
    const tracks = d.tracks.filter((t) => t.keys.length).flatMap((t) => {
      const b = d.bones.find((x) => x.id === t.bone)!, rest = restLocal(d, b), times = t.keys.map((k) => k.t);
      const quats = t.keys.flatMap((k) => new T.Quaternion().setFromEuler(new T.Euler(...(k.rot.map((v) => v * Math.PI / 180) as [number, number, number]), "XYZ")).toArray());
      const pos = t.keys.flatMap((k) => rest.map((v, i) => v + k.move[i]!));
      return [new T.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, quats), new T.VectorKeyframeTrack(`${b.name}.position`, times, pos)];
    });
    if (tracks.length) (root as unknown as { animations: unknown[] }).animations = [new T.AnimationClip("Animacion", d.duration, tracks)];
  }
  const animations = (root as unknown as { animations?: InstanceType<typeof T.AnimationClip>[] }).animations ?? [];
  const result = await new GLTFExporter().parseAsync(root, { binary: true, animations });
  geometry.dispose(); material.dispose();
  if (!(result instanceof ArrayBuffer)) throw new Error("No se pudo generar GLB.");
  return new Uint8Array(result);
}
