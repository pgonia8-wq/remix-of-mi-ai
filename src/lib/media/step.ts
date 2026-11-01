// ISO 10303-21 (STEP AP214) export of CAD solids as MANIFOLD_SOLID_BREP: planar ADVANCED_FACEs bounded by
// shared straight EDGE_CURVEs, exact millimetre coordinates. Curved primitives are represented by their
// tessellated planar facets (no NURBS/analytic cylinders or spheres).
type V3 = [number, number, number];
type Poly = V3[];
const num = (v: number) => { const [m = "0", e] = (Math.abs(v) < 1e-12 ? 0 : v).toExponential(10).split("e"); const mant = m.replace(/0+$/, "").replace(/\.$/, "."); const exp = Number(e); const fixed = mant.includes(".") ? mant : mant + "."; return exp === 0 ? fixed : `${fixed}E${exp}`; };
const str = (s: string) => `'${s.replace(/'/g, "''").replace(/[^\x20-\x7e]/g, "_")}'`;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
export function stepBrep(name: string, solids: Poly[][], when = new Date()): string {
  const valid = solids.filter((s) => s.length >= 4);
  if (!valid.length) throw new Error("No hay sólidos visibles para STEP.");
  const lines: string[] = []; let id = 0;
  const add = (body: string) => { lines.push(`#${++id}=${body};`); return `#${id}`; };
  const dir = (v: V3) => add(`DIRECTION('',(${v.map(num).join(",")}))`);
  const ctx = add("APPLICATION_CONTEXT('automotive design')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ctx})`);
  const pc = add(`PRODUCT_CONTEXT('',${ctx},'mechanical')`);
  const prod = add(`PRODUCT(${str(name)},${str(name)},'',(${pc}))`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
  const pdc = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ctx},'design')`);
  const pd = add(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const lu = add("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
  const au = add("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
  const sau = add("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),${lu},'distance_accuracy_value','confusion accuracy')`);
  const gctx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lu},${au},${sau}))REPRESENTATION_CONTEXT('Context3D','3D Context'))`);
  const axis = add(`AXIS2_PLACEMENT_3D('',${add("CARTESIAN_POINT('',(0.,0.,0.))")},$,$)`);
  const breps: string[] = [];
  for (const polys of valid) {
    const verts = new Map<string, { p: V3; point: string; vertex: string }>();
    const vertex = (v: V3) => { const key = v.map((n) => Math.round(n * 1e5)).join(","); let r = verts.get(key); if (!r) { const point = add(`CARTESIAN_POINT('',(${v.map(num).join(",")}))`); r = { p: v, point, vertex: add(`VERTEX_POINT('',${point})`) }; verts.set(key, r); } return { key, ...r }; };
    const edges = new Map<string, { ref: string; start: string }>();
    const edge = (a: ReturnType<typeof vertex>, b: ReturnType<typeof vertex>) => {
      const key = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
      let e = edges.get(key);
      if (!e) { const d = sub(b.p, a.p), line = add(`LINE('',${a.point},${add(`VECTOR('',${dir(unit(d))},${num(len(d))})`)})`); e = { ref: add(`EDGE_CURVE('',${a.vertex},${b.vertex},${line},.T.)`), start: a.key }; edges.set(key, e); }
      return add(`ORIENTED_EDGE('',*,*,${e.ref},${e.start === a.key ? ".T." : ".F."})`);
    };
    const faces: string[] = [];
    for (const poly of polys) {
      const vs = poly.map(vertex).filter((v, i, arr) => v.key !== arr[(i + 1) % arr.length]!.key);
      if (vs.length < 3) continue;
      const n = cross(sub(vs[1]!.p, vs[0]!.p), sub(vs[2]!.p, vs[0]!.p));
      if (len(n) < 1e-12) continue;
      const loop = add(`EDGE_LOOP('',(${vs.map((v, i) => edge(v, vs[(i + 1) % vs.length]!)).join(",")}))`);
      const plane = add(`PLANE('',${add(`AXIS2_PLACEMENT_3D('',${vs[0]!.point},${dir(unit(n))},${dir(unit(sub(vs[1]!.p, vs[0]!.p)))})`)})`);
      faces.push(add(`ADVANCED_FACE('',(${add(`FACE_OUTER_BOUND('',${loop},.T.)`)}),${plane},.T.)`));
    }
    breps.push(add(`MANIFOLD_SOLID_BREP('',${add(`CLOSED_SHELL('',(${faces.join(",")}))`)})`));
  }
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${str(name)},(${axis},${breps.join(",")}),${gctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
  const file = `${name.replace(/[^\w.-]/g, "_")}.step`;
  return ["ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION(('MI AI B-rep solid'),'2;1');",
    `FILE_NAME(${str(file)},'${when.toISOString().slice(0, 19)}',('MI AI'),(''),'MI AI CAD','MI AI','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", "ENDSEC;", "DATA;", ...lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}
