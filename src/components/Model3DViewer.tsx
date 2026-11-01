import { useEffect, useRef, useState } from "react";

/** Browser-only module imports occur after mount; GLB external URLs are never fetched. */
export type ModelStats = { meshes: number; vertices: number; triangles: number; size: [number, number, number] };
export function Model3DViewer({ bytes, name = "modelo" }: { bytes: Uint8Array; name?: string }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [wire, setWire] = useState(false);
  const sceneRef = useRef<unknown>(null);
  useEffect(() => {
    const el = host.current; if (!el) return;
    let live = true, cleanup = () => {};
    async function init() {
      if (!el) return;
      const [T, { GLTFLoader }, { OrbitControls }] = await Promise.all([import("three"), import("three/addons/loaders/GLTFLoader.js"), import("three/addons/controls/OrbitControls.js")]);
      if (!live) return;
      const manager = new T.LoadingManager();
      manager.setURLModifier((url) => { if (url.startsWith("blob:") || url.startsWith("data:")) return url; throw new Error("El GLB no puede cargar recursos externos."); });
      const model = await new GLTFLoader(manager).parseAsync(bytes.slice().buffer as ArrayBuffer, "");
      if (!live) return;
      const scene = new T.Scene(); scene.add(model.scene);
      scene.add(new T.HemisphereLight(0xffffff, 0x777777, 3));
      const key = new T.DirectionalLight(0xffffff, 3); key.position.set(3, 5, 4); scene.add(key);
      const box = new T.Box3().setFromObject(model.scene), center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
      model.scene.position.sub(center);
      let meshes = 0, vertices = 0, triangles = 0;
      model.scene.traverse((n) => { if (n instanceof T.Mesh) { meshes++; const g = n.geometry as InstanceType<typeof T.BufferGeometry>; const v = g.attributes["position"]?.count ?? 0; vertices += v; triangles += g.index ? g.index.count / 3 : v / 3; } });
      setStats({ meshes, vertices, triangles: Math.round(triangles), size: [size.x, size.y, size.z] });
      sceneRef.current = model.scene;
      const extent = Math.max(size.x, size.y, size.z, 0.1);
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      el.appendChild(renderer.domElement);
      const camera = new T.PerspectiveCamera(45, 1, extent / 100, extent * 100); camera.position.set(extent * 1.5, extent, extent * 2.2);
      const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
      let frame = 0;
      const resize = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }); resize.observe(el);
      function animate() { if (!live) return; controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); }
      animate();
      cleanup = () => {
        cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); renderer.dispose();
        model.scene.traverse((node) => { if (node instanceof T.Mesh) { node.geometry.dispose(); const mats = Array.isArray(node.material) ? node.material : [node.material]; for (const m of mats) { for (const v of Object.values(m)) if (v instanceof T.Texture) v.dispose(); m.dispose(); } } });
        renderer.domElement.remove();
      };
    }
    init().catch(() => live && setError("No se pudo abrir el modelo 3D; comprueba que sea GLB y que el dispositivo admita WebGL."));
    return () => { live = false; cleanup(); };
  }, [bytes]);
  useEffect(() => {
    const scene = sceneRef.current as { traverse?: (f: (n: unknown) => void) => void } | null;
    scene?.traverse?.((n) => { const m = (n as { material?: unknown }).material; for (const mat of (Array.isArray(m) ? m : m ? [m] : []) as { wireframe?: boolean }[]) mat.wireframe = wire; });
  }, [wire, stats]);
  async function exportAs(fmt: "stl" | "obj") {
    const scene = sceneRef.current; if (!scene) return;
    const { saveExport } = await import("@/lib/save-export");
    if (fmt === "stl") {
      const { STLExporter } = await import("three/addons/exporters/STLExporter.js");
      const out = new STLExporter().parse(scene as never, { binary: true }) as unknown as DataView;
      await saveExport(new Uint8Array(out.buffer), `${name.replace(/\.glb$/i, "")}.stl`, "model/stl");
    } else {
      const { OBJExporter } = await import("three/addons/exporters/OBJExporter.js");
      await saveExport(new TextEncoder().encode(new OBJExporter().parse(scene as never)), `${name.replace(/\.glb$/i, "")}.obj`, "model/obj");
    }
  }
  const fmt = (n: number) => (n >= 1 ? n.toFixed(2) : n.toPrecision(2));
  return <div className="space-y-2">{stats && <div className="space-y-2 text-xs"><p className="text-muted-foreground">Medidas (unidades del archivo, normalmente metros): {fmt(stats.size[0])} × {fmt(stats.size[1])} × {fmt(stats.size[2])} · {stats.meshes} mallas · {stats.vertices.toLocaleString()} vértices · {stats.triangles.toLocaleString()} triángulos</p><div className="flex flex-wrap gap-2"><label className="flex items-center gap-1"><input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} />Ver malla</label><button className="rounded border px-2 py-1" onClick={() => exportAs("stl").catch(() => setError("No se pudo convertir a STL."))}>Exportar STL (impresión 3D)</button><button className="rounded border px-2 py-1" onClick={() => exportAs("obj").catch(() => setError("No se pudo convertir a OBJ."))}>Exportar OBJ</button></div></div>}{error ? <p className="text-sm text-destructive">{error}</p> : <div ref={host} className="h-80 w-full overflow-hidden bg-secondary/30" aria-label="Modelo 3D interactivo" />}</div>;
}