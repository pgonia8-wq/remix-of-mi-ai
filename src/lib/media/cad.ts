import modeling from '@jscad/modeling';
export type CadFeature = { id:string; kind:'box'|'sphere'|'cylinder'|'extrude'|'union'|'subtract'|'intersect'; size:[number,number,number]; position:[number,number,number]; rotation:[number,number,number]; scale:[number,number,number]; refs:string[]; points:[number,number][]; visible:boolean };
export type CadDocument={version:1;unit:'mm';name:string;features:CadFeature[]};
export type Solid=ReturnType<typeof modeling.primitives.cuboid>;
export function newFeature(kind:CadFeature['kind']):CadFeature{return {id:crypto.randomUUID(),kind,size:[20,20,20],position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],refs:[],points:[[0,0],[20,0],[20,20],[0,20]],visible:true};}
export function buildCad(doc:CadDocument):Map<string,Solid>{
 if(doc.version!==1 || doc.unit!=='mm' || !Array.isArray(doc.features) || doc.features.length>64)throw new Error('Documento CAD inválido.');
 const solids=new Map<string,Solid>();
 for(const f of doc.features){
  if(!f.id||solids.has(f.id)||![...f.size,...f.position,...f.rotation,...f.scale].every(Number.isFinite)||f.size.some(n=>n<=0||n>10000)||f.scale.some(n=>n<=0||n>100)||f.position.some(n=>Math.abs(n)>100000))throw new Error('Dimensiones o transformación inválidas.');
  let s:Solid;
  switch(f.kind){case 'box':s=modeling.primitives.cuboid({size:f.size});break;case 'sphere':s=modeling.primitives.sphere({radius:f.size[0]/2,segments:32});break;case 'cylinder':s=modeling.primitives.cylinder({radius:f.size[0]/2,height:f.size[2],segments:32});break;case 'extrude':if(f.points.length<3||f.points.length>128||f.points.some(p=>p.length!==2||p.some(n=>!Number.isFinite(n)||Math.abs(n)>10000)))throw new Error('Perfil inválido.');s=modeling.extrusions.extrudeLinear({height:f.size[2]},modeling.primitives.polygon({points:f.points}));break;
   case 'union':case 'subtract':case 'intersect':{if(f.refs.length<2||f.refs.length>16)throw new Error('Elige dos sólidos anteriores.');const inputs=f.refs.map(id=>{const item=solids.get(id);if(!item)throw new Error('Referencia CAD inexistente o circular.');return item;});s=modeling.booleans[f.kind](...inputs);break;}
   default:throw new Error('Operación CAD desconocida.');
  }
  s=modeling.transforms.scale(f.scale,s);s=modeling.transforms.rotate([f.rotation[0]*Math.PI/180,f.rotation[1]*Math.PI/180,f.rotation[2]*Math.PI/180],s);s=modeling.transforms.translate(f.position,s);solids.set(f.id,s);
 }
 return solids;
}
export function cadTriangles(doc:CadDocument){const solids=buildCad(doc);const positions:number[]=[];for(const f of doc.features){if(!f.visible)continue;const s=solids.get(f.id);if(!s)continue;for(const p of modeling.geometries.geom3.toPolygons(s)){for(let i=1;i<p.vertices.length-1;i++){for(const v of [p.vertices[0],p.vertices[i],p.vertices[i+1]])if(v)positions.push(...v);}}}return new Float32Array(positions);}
export function cadMetrics(doc:CadDocument){const solids=buildCad(doc),visible=doc.features.filter(f=>f.visible).map(f=>solids.get(f.id)).filter((s):s is Solid=>!!s);return {volumeMm3:visible.reduce((v,s)=>v+modeling.measurements.measureVolume(s),0),bounds:visible.length?modeling.measurements.measureBoundingBox(modeling.booleans.union(...visible)):null};}
export async function exportCad(doc:CadDocument,format:'stl'|'obj'):Promise<Uint8Array>{const solids=buildCad(doc),items=doc.features.filter(f=>f.visible).map(f=>solids.get(f.id)).filter((s):s is Solid=>!!s);if(!items.length)throw new Error('No hay sólidos visibles.');if(format==='stl'){const m=await import('@jscad/stl-serializer');const result=m.serialize({binary:true},...items);return new Uint8Array(await new Blob(result as BlobPart[]).arrayBuffer());}const m=await import('@jscad/obj-serializer');return new TextEncoder().encode(m.serialize({},...items).join(''));}
