import { useEffect, useRef, useState } from "react";
import { Bone as BoneIcon, Download, Pause, Play, Plus, Save, Trash2, Wand2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { NeedProject, inputCls } from "./AppShell";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { visiblePolygons, type CadDocument } from "@/lib/media/cad";
import { autoAssign, meshFromPolygons, moveVertices, posedPositions, sampleKeys, setKey, validateMesh, verticesWithin, objFromPose, type MeshDoc, type V3 } from "@/lib/media/rig";

export function MeshRigStudio() { const pid = useActiveProjectId(); return pid ? <Studio pid={pid} key={pid} /> : <NeedProject />; }
const vec = (d: MeshDoc, i: number): V3 => [d.positions[i * 3]!, d.positions[i * 3 + 1]!, d.positions[i * 3 + 2]!];
const AX = ["X", "Y", "Z"];
function V3Input({ label, value, onChange }: { label: string; value: V3; onChange: (v: V3) => void }) {
  return <div><p className="text-xs">{label}</p><div className="grid grid-cols-3 gap-2">{value.map((v, i) => <input key={i} aria-label={`${label} ${AX[i]}`} className={inputCls} type="number" step={0.5} value={Number(v.toFixed(3))} onChange={(e) => { const next = [...value] as V3; next[i] = Number(e.target.value); onChange(next); }} />)}</div></div>;
}
function Studio({ pid }: { pid: string }) {
  const mutate = useCoreMutate();
  const { data: assets = [] } = useCoreQuery(["mesh-sources", pid], async (c) => (await c.assets.list(pid)).filter((a) => a.capability_id === "cad.document" || a.capability_id === "mesh.document"));
  const [doc, setDoc] = useState<MeshDoc | null>(null), [selected, setSelected] = useState<number[]>([]), [radius, setRadius] = useState(0), [delta, setDelta] = useState<V3>([0, 0, 0]);
  const [bone, setBone] = useState(""), [boneName, setBoneName] = useState("hueso1"), [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [pose, setPose] = useState<{ rot: V3; move: V3 }>({ rot: [0, 0, 0], move: [0, 0, 0] }), [busy, setBusy] = useState(false);
  useEffect(() => { if (!playing || !doc) return; let raf = 0, last = performance.now(); const tick = (now: number) => { setTime((t) => (t + (now - last) / 1000) % doc.duration); last = now; raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [playing, doc]);
  useEffect(() => { if (doc && bone) setPose(sampleKeys(doc.tracks.find((t) => t.bone === bone)?.keys ?? [], time)); }, [bone, time, doc]);
  async function action(fn: Parameters<typeof mutate>[0]) { setBusy(true); try { await mutate(fn); } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo completar"); } finally { setBusy(false); } }
  function update(next: MeshDoc) { try { validateMesh(next); setDoc(next); } catch (e) { toast.error(e instanceof Error ? e.message : "Cambio inválido"); } }
  const center = doc && selected[0] !== undefined ? vec(doc, selected[0]) : null;
  const keys = doc?.tracks.find((t) => t.bone === bone)?.keys ?? [];
  return <div className="space-y-4 p-4">
    <h1 className="text-2xl font-semibold">Malla, huesos y animación</h1>
    <select aria-label="Abrir pieza para malla" className={inputCls} value="" onChange={(e) => { const a = assets.find((x) => x.id === e.target.value); if (!a) return; action(async (c) => { const raw = JSON.parse(new TextDecoder().decode(await c.assets.read(pid, a.id))); const next: MeshDoc = a.capability_id === "cad.document" ? meshFromPolygons((raw as CadDocument).name, visiblePolygons(raw as CadDocument)) : raw; validateMesh(next); setDoc(next); setSelected([]); setBone(next.bones[0]?.id ?? ""); setTime(0); toast.success(`${(next.positions.length / 3).toLocaleString()} vértices listos para editar.`); }); }}>
      <option value="">Abrir pieza CAD o malla guardada…</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.capability_id === "cad.document" ? "CAD · " : "Malla · "}{a.name}</option>)}
    </select>
    {!doc ? <p className="border-y py-10 text-center text-sm text-muted-foreground">Guarda una pieza en CAD y ábrela aquí para editar vértices, añadir huesos y animarla.</p> : <>
      <RigViewport doc={doc} time={time} selected={selected} bone={bone} onPick={(i) => { setSelected(radius > 0 ? verticesWithin(doc, vec(doc, i), radius) : [i]); }} />
      <p className="text-xs text-muted-foreground">{(doc.positions.length / 3).toLocaleString()} vértices · {(doc.indices.length / 3).toLocaleString()} triángulos · toca un punto para seleccionarlo.</p>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="space-y-3 rounded-xl border bg-card p-3" aria-label="Edición de vértices"><h2 className="font-semibold">Edición de vértices</h2>
          <p className="text-xs">{selected.length ? `${selected.length} vértice(s) seleccionados${center ? ` · centro ${center.map((v) => v.toFixed(1)).join(", ")}` : ""}` : "Ningún vértice seleccionado"}</p>
          <label className="block text-xs">Radio de selección suave (mm, 0 = un vértice)<input aria-label="Radio de selección" className={inputCls} type="number" min={0} step={1} value={radius} onChange={(e) => setRadius(Math.max(0, Number(e.target.value)))} /></label>
          <V3Input label="Desplazamiento (mm)" value={delta} onChange={setDelta} />
          <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!selected.length} onClick={() => update(moveVertices(doc, selected, delta, radius > 0 && center ? { center, radius } : undefined))}>Mover vértices</Button><Button size="sm" variant="outline" onClick={() => setSelected([])}>Limpiar selección</Button></div>
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-3" aria-label="Huesos"><h2 className="flex items-center gap-2 font-semibold"><BoneIcon className="h-4 w-4 text-primary" />Huesos (rigging)</h2>
          {doc.bones.map((b) => <div key={b.id} className="flex items-center gap-2 text-sm"><Button size="sm" variant={bone === b.id ? "secondary" : "ghost"} className="min-w-0 flex-1 justify-start truncate" onClick={() => setBone(b.id)}>{b.name}{b.parent ? ` ← ${doc.bones.find((x) => x.id === b.parent)?.name}` : " (raíz)"}</Button><Button size="icon" variant="ghost" aria-label={`Eliminar hueso ${b.name}`} onClick={() => { if (doc.bones.some((x) => x.parent === b.id)) { toast.error("Primero elimina sus huesos hijos."); return; } const idx = doc.bones.indexOf(b); update({ ...doc, bones: doc.bones.filter((x) => x.id !== b.id), tracks: doc.tracks.filter((t) => t.bone !== b.id), weights: doc.weights.map((w) => w === idx ? -1 : w > idx ? w - 1 : w) }); if (bone === b.id) setBone(""); }}><Trash2 /></Button></div>)}
          <div className="grid grid-cols-[1fr_auto] gap-2"><input aria-label="Nombre del hueso" className={inputCls} value={boneName} onChange={(e) => setBoneName(e.target.value)} /><Button size="sm" variant="outline" disabled={!/^[\w-]{1,40}$/.test(boneName)} onClick={() => { const id = crypto.randomUUID(); const head = center ?? [0, 0, 0]; update({ ...doc, bones: [...doc.bones, { id, name: boneName, parent: bone || null, head }] }); setBone(id); setBoneName(`hueso${doc.bones.length + 2}`); }}><Plus />Hueso</Button></div>
          <p className="text-xs text-muted-foreground">El hueso nuevo nace en el vértice seleccionado y cuelga del hueso activo.</p>
          <Button size="sm" variant="outline" disabled={!doc.bones.length} onClick={() => { update(autoAssign(doc)); toast.success("Vértices asignados al hueso más cercano."); }}><Wand2 />Asignar vértices automáticamente</Button>
          {!!selected.length && !!bone && <Button size="sm" variant="ghost" onClick={() => { const idx = doc.bones.findIndex((b) => b.id === bone); const weights = doc.weights.slice(); selected.forEach((i) => { weights[i] = idx; }); update({ ...doc, weights }); }}>Asignar selección al hueso activo</Button>}
        </section>
      </div>
      <section className="space-y-3 rounded-xl border bg-card p-3" aria-label="Animación"><h2 className="font-semibold">Animación por keyframes</h2>
        <div className="flex items-center gap-2"><Button size="icon" variant="outline" aria-label={playing ? "Pausar animación" : "Reproducir animación"} onClick={() => setPlaying(!playing)}>{playing ? <Pause /> : <Play />}</Button><input aria-label="Tiempo de animación" type="range" className="flex-1 accent-primary" min={0} max={doc.duration} step={0.01} value={time} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} /><span className="w-16 text-right text-xs">{time.toFixed(2)} s</span></div>
        <label className="block text-xs">Duración (s)<input aria-label="Duración de animación" className={inputCls} type="number" min={0.1} max={600} step={0.1} value={doc.duration} onChange={(e) => update({ ...doc, duration: Number(e.target.value), tracks: doc.tracks.map((t) => ({ ...t, keys: t.keys.filter((k) => k.t <= Number(e.target.value)) })) })} /></label>
        {bone ? <><V3Input label="Rotación del hueso (°)" value={pose.rot} onChange={(rot) => setPose({ ...pose, rot })} /><V3Input label="Traslación del hueso (mm)" value={pose.move} onChange={(move) => setPose({ ...pose, move })} />
          <Button size="sm" onClick={() => update(setKey(doc, bone, { t: Number(time.toFixed(3)), ...pose }))}><KeyRound />Fijar keyframe en {time.toFixed(2)} s</Button>
          <div className="flex flex-wrap gap-1">{keys.map((k) => <Button key={k.t} size="sm" variant="secondary" onClick={() => { setPlaying(false); setTime(k.t); }} onDoubleClick={() => update({ ...doc, tracks: doc.tracks.map((t) => t.bone === bone ? { ...t, keys: t.keys.filter((x) => x.t !== k.t) } : t) })}>{k.t.toFixed(2)} s</Button>)}</div>
          {!!keys.length && <p className="text-xs text-muted-foreground">Toca un keyframe para ir a él; doble toque para borrarlo.</p>}</> : <p className="text-xs text-muted-foreground">Crea o elige un hueso para animarlo.</p>}
      </section>
      <section className="flex flex-wrap gap-2 border-t pt-4">
        <input aria-label="Nombre de la malla" className={inputCls + " max-w-56"} value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} />
        <Button disabled={busy} onClick={() => action(async (c) => { validateMesh(doc); const bytes = new TextEncoder().encode(JSON.stringify(doc)); await c.assets.put(pid, (async function* () { yield bytes; })(), { kind: "document", mime: "application/json", name: `${doc.name}.miaimesh`, capability: "mesh.document" }); toast.success("Malla cifrada guardada."); })}><Save />Guardar malla</Button>
        <Button variant="outline" disabled={busy} onClick={() => action(async (c) => { const { exportRiggedGlb } = await import("@/lib/media/rig-export"); const bytes = await exportRiggedGlb(doc); await c.assets.put(pid, (async function* () { yield bytes; })(), { kind: "model3d", mime: "model/gltf-binary", name: `${doc.name}.glb`, capability: "mesh.export" }); toast.success(doc.tracks.length ? "GLB animado cifrado en Biblioteca." : "GLB cifrado en Biblioteca."); })}><Download />GLB animado</Button>
        <Button variant="outline" disabled={busy} onClick={() => action(async (c) => { const bytes = objFromPose(doc, time); await c.assets.put(pid, (async function* () { yield bytes; })(), { kind: "model3d", mime: "model/obj", name: `${doc.name}-pose.obj`, capability: "mesh.export" }); toast.success("Pose actual en OBJ cifrada."); })}><Download />OBJ de la pose</Button>
      </section>
    </>}
  </div>;
}
function RigViewport({ doc, time, selected, bone, onPick }: { doc: MeshDoc; time: number; selected: number[]; bone: string; onPick: (i: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null), api = useRef<{ update: (d: MeshDoc, t: number, sel: number[], bone: string) => void; reset: () => void } | null>(null), pick = useRef(onPick), [error, setError] = useState("");
  pick.current = onPick;
  useEffect(() => {
    const el = ref.current; if (!el) return; let disposed = false, cleanup = () => {};
    (async () => {
      const [T, { OrbitControls }] = await Promise.all([import("three"), import("three/addons/controls/OrbitControls.js")]); if (disposed) return;
      const css = getComputedStyle(el), color = (v: string) => { const c = document.createElement("canvas").getContext("2d"); if (!c) return new T.Color(); c.fillStyle = css.getPropertyValue(v).trim(); c.fillRect(0, 0, 1, 1); const p = c.getImageData(0, 0, 1, 1).data; return new T.Color().setRGB(p[0]! / 255, p[1]! / 255, p[2]! / 255, T.SRGBColorSpace); };
      const scene = new T.Scene(), renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); el.appendChild(renderer.domElement);
      scene.add(new T.HemisphereLight(color("--foreground"), color("--background"), 2.5)); const light = new T.DirectionalLight(color("--foreground"), 2.5); light.position.set(30, 60, 40); scene.add(light);
      const geometry = new T.BufferGeometry(), material = new T.MeshStandardMaterial({ color: color("--primary"), roughness: 0.45, side: T.DoubleSide, transparent: true, opacity: 0.92 }), mesh = new T.Mesh(geometry, material); scene.add(mesh);
      const pointsGeo = new T.BufferGeometry(), pointsMat = new T.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true }), points = new T.Points(pointsGeo, pointsMat); scene.add(points);
      const boneGeo = new T.BufferGeometry(), boneLines = new T.LineSegments(boneGeo, new T.LineBasicMaterial({ color: color("--success"), depthTest: false })); boneLines.renderOrder = 2; scene.add(boneLines);
      const camera = new T.PerspectiveCamera(45, 1, 0.1, 100000), controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
      const ray = new T.Raycaster(), ndc = new T.Vector2(); let down: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
      const onUp = (e: PointerEvent) => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; } down = null; const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); ray.params.Points = { threshold: Math.max(0.5, camera.position.distanceTo(controls.target) / 80) }; const hit = ray.intersectObject(points)[0]; if (hit?.index !== undefined) pick.current(hit.index); };
      renderer.domElement.addEventListener("pointerdown", onDown); renderer.domElement.addEventListener("pointerup", onUp);
      const base = color("--muted-foreground"), sel = color("--warning");
      api.current = {
        update(d, t, selection, activeBone) {
          const posed = posedPositions(d, t);
          geometry.setAttribute("position", new T.BufferAttribute(posed, 3)); geometry.setIndex(d.indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
          pointsGeo.setAttribute("position", new T.BufferAttribute(posed, 3)); const colors = new Float32Array(posed.length); for (let i = 0; i < posed.length / 3; i++) base.toArray(colors, i * 3); for (const i of selection) sel.toArray(colors, i * 3); pointsGeo.setAttribute("color", new T.BufferAttribute(colors, 3)); pointsGeo.computeBoundingSphere(); points.visible = posed.length / 3 <= 20000;
          const segs: number[] = []; const heads = new Map<string, V3>(); const skin = d.bones.length ? posedPositions({ ...d, positions: d.bones.flatMap((b) => b.head), indices: [], weights: d.bones.map((_, i) => i) }, t) : new Float32Array(); d.bones.forEach((b, i) => heads.set(b.id, [skin[i * 3]!, skin[i * 3 + 1]!, skin[i * 3 + 2]!]));
          for (const b of d.bones) { const h = heads.get(b.id)!; const p = b.parent ? heads.get(b.parent)! : null; if (p) segs.push(...p, ...h); const s = b.id === activeBone ? 2 : 1; segs.push(h[0] - s, h[1], h[2], h[0] + s, h[1], h[2], h[0], h[1] - s, h[2], h[0], h[1] + s, h[2]); }
          boneGeo.setAttribute("position", new T.Float32BufferAttribute(segs, 3));
        },
        reset() { geometry.computeBoundingSphere(); const s = geometry.boundingSphere; const r = Math.max(s?.radius ?? 20, 1); controls.target.copy(s?.center ?? new T.Vector3()); camera.position.set(controls.target.x + r * 1.6, controls.target.y + r * 1.1, controls.target.z + r * 2.2); camera.far = r * 200; camera.updateProjectionMatrix(); },
      };
      api.current.update(doc, time, selected, bone); api.current.reset();
      const resize = () => { renderer.setSize(el.clientWidth, el.clientHeight); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); }; const ro = new ResizeObserver(resize); ro.observe(el); resize();
      let frame = 0; const loop = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(loop); }; loop();
      cleanup = () => { cancelAnimationFrame(frame); ro.disconnect(); controls.dispose(); renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp); geometry.dispose(); material.dispose(); pointsGeo.dispose(); pointsMat.dispose(); boneGeo.dispose(); renderer.dispose(); renderer.domElement.remove(); api.current = null; };
    })().catch((e) => setError(e instanceof Error ? e.message : "WebGL no disponible"));
    return () => { disposed = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { api.current?.update(doc, time, selected, bone); }, [doc, time, selected, bone]);
  return <><div ref={ref} className="h-96 w-full touch-none overflow-hidden rounded-xl border bg-secondary/20" aria-label="Vista 3D de malla con huesos" />{error && <p className="text-sm text-destructive">{error}</p>}</>;
}
