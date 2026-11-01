import { useEffect, useRef, useState } from "react";

/** Browser-only module imports occur after mount; GLB external URLs are never fetched. */
export function Model3DViewer({ bytes }: { bytes: Uint8Array }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
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
  return <div>{error ? <p className="text-sm text-destructive">{error}</p> : <div ref={host} className="h-80 w-full overflow-hidden bg-secondary/30" aria-label="Modelo 3D interactivo" />}</div>;
}