// ISO 10303-21 (STEP AP214) export of CAD solids as FACETED_BREP: planar polygon faces with exact
// vertex coordinates in millimetres. This is a faceted boundary representation, not NURBS/analytic surfaces.
type Poly = [number, number, number][];
const num = (v: number) => { const [m = "0", e] = (Math.abs(v) < 1e-12 ? 0 : v).toExponential(10).split("e"); const mant = m.replace(/0+$/, "").replace(/\.$/, "."); const exp = Number(e); return exp === 0 ? (mant.includes(".") ? mant : mant + ".") : `${mant.includes(".") ? mant : mant + "."}E${exp}`; };
const str = (s: string) => `'${s.replace(/'/g, "''").replace(/[^\x20-\x7e]/g, "_")}'`;
export function stepFaceted(name: string, solids: Poly[][], when = new Date()): string {
  const valid = solids.filter((s) => s.length >= 4);
  if (!valid.length) throw new Error("No hay sólidos visibles para STEP.");
  const lines: string[] = []; let id = 0;
  const add = (body: string) => { lines.push(`#${++id}=${body};`); return `#${id}`; };
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
  const origin = add("CARTESIAN_POINT('',(0.,0.,0.))");
  const axis = add(`AXIS2_PLACEMENT_3D('',${origin},$,$)`);
  const breps: string[] = [];
  for (const polys of valid) {
    const points = new Map<string, string>();
    const point = (v: [number, number, number]) => { const key = v.map((n) => Math.round(n * 1e6)).join(","); let ref = points.get(key); if (!ref) { ref = add(`CARTESIAN_POINT('',(${v.map(num).join(",")}))`); points.set(key, ref); } return ref; };
    const faces: string[] = [];
    for (const p of polys) {
      if (p.length < 3) continue;
      const refs = p.map(point).filter((r, i, a) => r !== a[(i + 1) % a.length]);
      if (new Set(refs).size < 3) continue;
      const loop = add(`POLY_LOOP('',(${refs.join(",")}))`), bound = add(`FACE_OUTER_BOUND('',${loop},.T.)`);
      faces.push(add(`FACE('',(${bound}))`));
    }
    const shell = add(`CLOSED_SHELL('',(${faces.join(",")}))`);
    breps.push(add(`FACETED_BREP('',${shell})`));
  }
  const rep = add(`FACETED_BREP_SHAPE_REPRESENTATION(${str(name)},(${axis},${breps.join(",")}),${gctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
  const file = `${name.replace(/[^\w.-]/g, "_")}.step`;
  return ["ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION(('MI AI faceted solid'),'2;1');",
    `FILE_NAME(${str(file)},'${when.toISOString().slice(0, 19)}',('MI AI'),(''),'MI AI CAD','MI AI','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", "ENDSEC;", "DATA;", ...lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}
