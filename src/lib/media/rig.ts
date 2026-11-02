// Editable meshes with a bone hierarchy, rigid skinning and keyframed animation. Pure math (no Three.js)
// so posing is testable; the transform convention matches glTF/Three.js bones exactly:
// boneWorld = parentWorld · T(restLocal + move) · R(euler XYZ), skin = boneWorld · T(−restHead).
export type V3 = [number, number, number];
export type Bone = { id: string; name: string; parent: string | null; head: V3 };
/** ease: linear (default), ease (smooth in/out), in, out, step (hold until the next key). */
export type Ease = "linear" | "ease" | "in" | "out" | "step";
export type Key = { t: number; rot: V3; move: V3; ease?: Ease };
export type BoneTrack = { bone: string; keys: Key[] };
/** weights = main bone per vertex; optional weights2/blend give smooth two-bone skinning (blend = share of weights2, 0–0.5). */
export type MeshDoc = { version: 1; name: string; positions: number[]; indices: number[]; bones: Bone[]; weights: number[]; weights2?: number[]; blend?: number[]; tracks: BoneTrack[]; duration: number };
type M4 = Float64Array;
export const MAX_VERTICES = 200_000, MAX_BONES = 64;

export function meshFromPolygons(name: string, solids: V3[][][]): MeshDoc {
  const positions: number[] = [], indices: number[] = [], map = new Map<string, number>();
  const vid = (v: V3) => { const k = v.map((n) => Math.round(n * 1e4)).join(","); let i = map.get(k); if (i === undefined) { i = positions.length / 3; positions.push(v[0], v[1], v[2]); map.set(k, i); } return i; };
  for (const polys of solids) for (const p of polys) { const ids = p.map(vid); for (let i = 1; i < ids.length - 1; i++) if (ids[0] !== ids[i] && ids[i] !== ids[i + 1] && ids[0] !== ids[i + 1]) indices.push(ids[0]!, ids[i]!, ids[i + 1]!); }
  if (!indices.length) throw new Error("No hay geometría visible para convertir en malla.");
  if (positions.length / 3 > MAX_VERTICES) throw new Error("Malla demasiado grande para editar en el teléfono.");
  return { version: 1, name, positions, indices, bones: [], weights: new Array(positions.length / 3).fill(-1), tracks: [], duration: 2 };
}
export function validateMesh(d: MeshDoc) {
  const n = d.positions.length / 3;
  if (d.version !== 1 || !Number.isInteger(n) || n < 3 || n > MAX_VERTICES || d.indices.length % 3 || d.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= n) || !d.positions.every(Number.isFinite)) throw new Error("Malla inválida.");
  if (d.bones.length > MAX_BONES) throw new Error(`Máximo ${MAX_BONES} huesos.`);
  const ids = new Set(d.bones.map((b) => b.id));
  if (ids.size !== d.bones.length || new Set(d.bones.map((b) => b.name)).size !== d.bones.length) throw new Error("Huesos duplicados.");
  for (const b of d.bones) { if (!/^[\w-]{1,40}$/.test(b.name) || !b.head.every(Number.isFinite)) throw new Error(`Hueso inválido: ${b.name}`); if (b.parent !== null && !ids.has(b.parent)) throw new Error("Padre de hueso inexistente."); }
  boneOrder(d.bones); // throws on cycles
  if (d.weights.length !== n || d.weights.some((w) => !Number.isInteger(w) || w < -1 || w >= d.bones.length)) throw new Error("Asignación de vértices inválida.");
  if (!Number.isFinite(d.duration) || d.duration <= 0 || d.duration > 600) throw new Error("Duración de animación inválida.");
  if (d.weights2 || d.blend) { if (d.weights2?.length !== n || d.blend?.length !== n || d.weights2.some((w) => !Number.isInteger(w) || w < -1 || w >= d.bones.length) || d.blend.some((b) => !Number.isFinite(b) || b < 0 || b > 0.5)) throw new Error("Mezcla de huesos inválida."); }
  for (const t of d.tracks) { if (t.keys.some((k) => k.ease !== undefined && !["linear", "ease", "in", "out", "step"].includes(k.ease))) throw new Error("Curva de animación inválida."); if (!ids.has(t.bone)) throw new Error("Pista de hueso inexistente."); if (t.keys.some((k) => !Number.isFinite(k.t) || k.t < 0 || k.t > d.duration || ![...k.rot, ...k.move].every(Number.isFinite))) throw new Error("Keyframe inválido."); }
}
/** Parents before children; rejects cycles. */
export function boneOrder(bones: Bone[]): Bone[] {
  const byId = new Map(bones.map((b) => [b.id, b])), out: Bone[] = [], state = new Map<string, number>();
  const visit = (b: Bone) => { const s = state.get(b.id); if (s === 2) return; if (s === 1) throw new Error("Jerarquía de huesos circular."); state.set(b.id, 1); if (b.parent) visit(byId.get(b.parent)!); state.set(b.id, 2); out.push(b); };
  bones.forEach(visit); return out;
}
export function moveVertices(d: MeshDoc, ids: number[], delta: V3, falloff?: { center: V3; radius: number }): MeshDoc {
  const positions = d.positions.slice();
  for (const i of ids) { if (!Number.isInteger(i) || i < 0 || i * 3 >= positions.length) throw new Error("Vértice inexistente."); let w = 1; if (falloff && falloff.radius > 0) { const dist = Math.hypot(positions[i * 3]! - falloff.center[0], positions[i * 3 + 1]! - falloff.center[1], positions[i * 3 + 2]! - falloff.center[2]); w = Math.max(0, 1 - dist / falloff.radius); w = w * w * (3 - 2 * w); } for (let k = 0; k < 3; k++) positions[i * 3 + k]! += delta[k]! * w; }
  return { ...d, positions };
}
export function verticesWithin(d: MeshDoc, center: V3, radius: number) { const out: number[] = []; for (let i = 0; i < d.positions.length / 3; i++) if (Math.hypot(d.positions[i * 3]! - center[0], d.positions[i * 3 + 1]! - center[1], d.positions[i * 3 + 2]! - center[2]) <= radius) out.push(i); return out; }
/** Rigid skinning: each vertex follows the bone whose segment (head → first child head) is closest. */
/** Nearest-bone skinning. With `smooth`, vertices near a joint also follow the second-nearest bone (soft bends). */
export function autoAssign(d: MeshDoc, o: { smooth?: boolean; falloff?: number } = {}): MeshDoc {
  if (!d.bones.length) throw new Error("Crea al menos un hueso.");
  const segs = d.bones.map((b) => { const child = d.bones.find((c) => c.parent === b.id); return { a: b.head, b: child?.head ?? b.head }; });
  const n = d.positions.length / 3, weights = new Array<number>(n), weights2 = new Array<number>(n).fill(-1), blend = new Array<number>(n).fill(0);
  let span = 0; for (const s of segs) span = Math.max(span, Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]));
  const fall = o.falloff ?? Math.max(1e-6, span * 0.25);
  for (let i = 0; i < n; i++) {
    const p: V3 = [d.positions[i * 3]!, d.positions[i * 3 + 1]!, d.positions[i * 3 + 2]!];
    let best = 0, bestD = Infinity, second = -1, secondD = Infinity;
    segs.forEach((s, j) => {
      const ab = s.b.map((v, k) => v - s.a[k]!) as V3, ap = p.map((v, k) => v - s.a[k]!) as V3, l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = l2 ? Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0, q = s.a.map((v, k) => v + ab[k]! * t), dist = Math.hypot(p[0] - q[0]!, p[1] - q[1]!, p[2] - q[2]!);
      if (dist < bestD - 1e-9) { second = best; secondD = bestD; best = j; bestD = dist; } else if (dist < secondD - 1e-9) { second = j; secondD = dist; }
    });
    weights[i] = best;
    if (o.smooth && second >= 0 && second !== best && Number.isFinite(secondD)) {
      const gap = secondD - bestD; // equal distance → 50/50, beyond `fall` → rigid
      if (gap < fall) { weights2[i] = second; blend[i] = Math.round(0.5 * (1 - gap / fall) * 1000) / 1000; }
    }
  }
  return o.smooth ? { ...d, weights, weights2, blend } : (() => { const { weights2: _w, blend: _b, ...rest } = d; return { ...rest, weights }; })();
}
const easeFn: Record<Ease, (u: number) => number> = {
  linear: (u) => u, ease: (u) => u * u * (3 - 2 * u), in: (u) => u * u, out: (u) => 1 - (1 - u) * (1 - u), step: () => 0,
};
type Q = [number, number, number, number];
const toRad = Math.PI / 180;
/** Euler XYZ (degrees, Three.js order) → quaternion and back; used so rotations take the shortest smooth path. */
function quatFromEuler(e: V3): Q {
  const [x, y, z] = e.map((v) => v * toRad / 2) as V3, c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z), s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
function eulerFromQuat([x, y, z, w]: Q): V3 {
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w), m13 = 2 * (x * z + y * w), m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w), m32 = 2 * (y * z + x * w), m33 = 1 - 2 * (x * x + y * y);
  const ry = Math.asin(Math.max(-1, Math.min(1, m13)));
  const [rx, rz] = Math.abs(m13) < 0.9999999 ? [Math.atan2(-m23, m33), Math.atan2(-m12, m11)] : [Math.atan2(m32, m22), 0];
  return [rx / toRad, ry / toRad, rz / toRad];
}
function slerp(a: Q, b: Q, u: number): Q {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; let bb = b;
  if (dot < 0) { dot = -dot; bb = b.map((v) => -v) as Q; }
  if (dot > 0.9995) { const r = a.map((v, i) => v + (bb[i]! - v) * u) as Q; const l = Math.hypot(...r); return r.map((v) => v / l) as Q; }
  const th = Math.acos(dot), s = Math.sin(th), wa = Math.sin((1 - u) * th) / s, wb = Math.sin(u * th) / s;
  return a.map((v, i) => v * wa + bb[i]! * wb) as Q;
}
export function sampleKeys(keys: Key[], t: number): { rot: V3; move: V3 } {
  if (!keys.length) return { rot: [0, 0, 0], move: [0, 0, 0] };
  const ks = [...keys].sort((a, b) => a.t - b.t);
  if (t <= ks[0]!.t) return ks[0]!; const last = ks[ks.length - 1]!; if (t >= last.t) return last;
  const i = ks.findIndex((k) => k.t > t), a = ks[i - 1]!, b = ks[i]!, u = easeFn[a.ease ?? "linear"]((t - a.t) / (b.t - a.t));
  const move = a.move.map((v, k) => v + (b.move[k]! - v) * u) as V3;
  const same = a.rot.every((v, k) => v === b.rot[k]);
  return { rot: same || u === 0 ? a.rot : u === 1 ? b.rot : eulerFromQuat(slerp(quatFromEuler(a.rot), quatFromEuler(b.rot), u)), move };
}
/** Bake keys to a fixed frame rate (for formats without easing such as glTF linear tracks). */
export function bakeTrack(keys: Key[], duration: number, fps = 30): Key[] {
  const out: Key[] = []; const n = Math.max(1, Math.round(duration * fps));
  for (let f = 0; f <= n; f++) { const t = Math.min(duration, f / fps); const s = sampleKeys(keys, t); out.push({ t, rot: s.rot, move: s.move }); }
  return out;
}
function ident(): M4 { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
function mul(a: M4, b: M4): M4 { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!; o[c * 4 + r] = s; } return o; }
function trans(v: V3): M4 { const m = ident(); m[12] = v[0]; m[13] = v[1]; m[14] = v[2]; return m; }
/** Euler XYZ in degrees (Three.js default order: R = Rx · Ry · Rz). */
function rot(deg: V3): M4 {
  const [x, y, z] = deg.map((d) => d * Math.PI / 180) as V3, a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z), m = ident();
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  m[0] = c * e; m[4] = -c * f; m[8] = d; m[1] = af + be * d; m[5] = ae - bf * d; m[9] = -b * c; m[2] = bf - ae * d; m[6] = be + af * d; m[10] = a * c;
  return m;
}
export function restLocal(d: MeshDoc, b: Bone): V3 { const p = b.parent ? d.bones.find((x) => x.id === b.parent) : null; return p ? b.head.map((v, k) => v - p.head[k]!) as V3 : b.head; }
export function skinMatrices(d: MeshDoc, t: number): Map<string, M4> {
  const world = new Map<string, M4>(), skin = new Map<string, M4>();
  for (const b of boneOrder(d.bones)) {
    const s = sampleKeys(d.tracks.find((x) => x.bone === b.id)?.keys ?? [], t), local = restLocal(d, b);
    const w = mul(b.parent ? world.get(b.parent)! : ident(), mul(trans(local.map((v, k) => v + s.move[k]!) as V3), rot(s.rot)));
    world.set(b.id, w); skin.set(b.id, mul(w, trans(b.head.map((v) => -v) as V3)));
  }
  return skin;
}
export function posedPositions(d: MeshDoc, t: number): Float32Array {
  const out = new Float32Array(d.positions);
  if (!d.bones.length) return out;
  const skins = skinMatrices(d, t), list = d.bones.map((b) => skins.get(b.id)!);
  const apply = (m: M4, x: number, y: number, z: number): V3 => [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
  for (let i = 0; i < out.length / 3; i++) {
    const m = list[d.weights[i] ?? -1]; if (!m) continue;
    const x = d.positions[i * 3]!, y = d.positions[i * 3 + 1]!, z = d.positions[i * 3 + 2]!;
    let p = apply(m, x, y, z);
    const m2 = list[d.weights2?.[i] ?? -1], w2 = d.blend?.[i] ?? 0;
    if (m2 && w2 > 0) { const q = apply(m2, x, y, z); p = p.map((v, k) => v * (1 - w2) + q[k]! * w2) as V3; }
    out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2];
  }
  return out;
}
export function setKey(d: MeshDoc, bone: string, key: Key): MeshDoc {
  const tracks = d.tracks.some((t) => t.bone === bone) ? d.tracks : [...d.tracks, { bone, keys: [] }];
  return { ...d, tracks: tracks.map((t) => t.bone !== bone ? t : { ...t, keys: [...t.keys.filter((k) => Math.abs(k.t - key.t) > 1e-4), key].sort((a, b) => a.t - b.t) }) };
}
export function objFromPose(d: MeshDoc, t: number): Uint8Array {
  const p = posedPositions(d, t), lines = [`# MI AI · ${d.name} · t=${t.toFixed(2)} s`];
  for (let i = 0; i < p.length; i += 3) lines.push(`v ${p[i]!.toFixed(5)} ${p[i + 1]!.toFixed(5)} ${p[i + 2]!.toFixed(5)}`);
  for (let i = 0; i < d.indices.length; i += 3) lines.push(`f ${d.indices[i]! + 1} ${d.indices[i + 1]! + 1} ${d.indices[i + 2]! + 1}`);
  return new TextEncoder().encode(lines.join("\n") + "\n");
}
