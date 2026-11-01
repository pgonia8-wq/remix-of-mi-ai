import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Builds an inpainting mask: painted pixels become transparent (area to repaint), the rest stays opaque. */
export function buildMask(painted: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { out[i * 4 + 3] = painted[i * 4 + 3]! > 0 ? 0 : 255; }
  return out;
}

export function MaskPainter({ src, onMask, disabled }: { src: string; onMask: (png: Uint8Array | null) => void; disabled?: boolean }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [brush, setBrush] = useState(40);
  const drawing = useRef(false);
  useEffect(() => {
    const i = new Image();
    i.onload = () => { img.current = i; setSize({ w: i.naturalWidth, h: i.naturalHeight }); };
    i.src = src;
  }, [src]);
  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h };
  }
  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !canvas.current) return;
    const ctx = canvas.current.getContext("2d")!; const { x, y } = pos(e);
    ctx.fillStyle = "rgba(255,0,80,0.55)"; ctx.beginPath(); ctx.arc(x, y, (brush * size.w) / 600, 0, Math.PI * 2); ctx.fill();
  }
  async function finish() {
    const c = canvas.current; if (!c) return;
    const data = c.getContext("2d")!.getImageData(0, 0, size.w, size.h);
    if (!data.data.some((v, i) => i % 4 === 3 && v > 0)) { onMask(null); return; }
    const out = document.createElement("canvas"); out.width = size.w; out.height = size.h;
    out.getContext("2d")!.putImageData(new ImageData(buildMask(data.data, size.w, size.h) as Uint8ClampedArray<ArrayBuffer>, size.w, size.h), 0, 0);
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
    onMask(blob ? new Uint8Array(await blob.arrayBuffer()) : null);
  }
  if (!size.w) return null;
  return (
    <div className="space-y-2">
      <div className="relative">
        <img src={src} alt="Imagen a editar" className="w-full rounded-xl border" />
        <canvas ref={canvas} width={size.w} height={size.h} aria-label="Pinta la zona a cambiar" className="absolute inset-0 h-full w-full touch-none rounded-xl"
          onPointerDown={(e) => { if (disabled) return; drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); paint(e); }}
          onPointerMove={paint} onPointerUp={() => { drawing.current = false; void finish(); }} />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <label className="flex flex-1 items-center gap-2">Pincel<input type="range" min={10} max={120} value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="flex-1" /></label>
        <Button size="sm" variant="outline" onClick={() => { const c = canvas.current; c?.getContext("2d")!.clearRect(0, 0, size.w, size.h); onMask(null); }}>Borrar máscara</Button>
      </div>
    </div>
  );
}
