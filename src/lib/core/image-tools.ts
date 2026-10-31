// On-device image tools (no provider, no cost, offline). Every result is saved as a NEW encrypted version.
export type ImageOp =
  | { op: "rotate"; deg: 90 | 180 | 270 }
  | { op: "flip"; axis: "h" | "v" }
  | { op: "crop"; aspect: "1:1" | "4:3" | "3:4" | "16:9" | "9:16" }
  | { op: "resize"; scale: number }
  | { op: "convert"; mime: "image/png" | "image/jpeg" | "image/webp"; quality?: number };

/** Max output edge: keeps a low-RAM phone (Poco C40) from allocating a huge canvas. */
export const MAX_EDGE = 4096;

export type Plan = { sw: number; sh: number; sx: number; sy: number; dw: number; dh: number; outW: number; outH: number; rotate: number; flipH: boolean; flipV: boolean; mime: string; quality: number };

export function planOp(w: number, h: number, srcMime: string, o: ImageOp): Plan {
  if (!(w > 0 && h > 0)) throw new Error("Imagen sin dimensiones válidas.");
  const base: Plan = { sx: 0, sy: 0, sw: w, sh: h, dw: w, dh: h, outW: w, outH: h, rotate: 0, flipH: false, flipV: false, mime: srcMime === "image/gif" ? "image/png" : srcMime, quality: 0.92 };
  switch (o.op) {
    case "rotate": { const swap = o.deg !== 180; return { ...base, rotate: o.deg, outW: swap ? h : w, outH: swap ? w : h }; }
    case "flip": return { ...base, flipH: o.axis === "h", flipV: o.axis === "v" };
    case "crop": {
      const [a, b] = o.aspect.split(":").map(Number) as [number, number];
      const target = a / b;
      let cw = w, ch = h;
      if (w / h > target) cw = Math.round(h * target); else ch = Math.round(w / target);
      return { ...base, sx: Math.floor((w - cw) / 2), sy: Math.floor((h - ch) / 2), sw: cw, sh: ch, dw: cw, dh: ch, outW: cw, outH: ch };
    }
    case "resize": {
      if (!(o.scale > 0) || o.scale > 4) throw new Error("Escala fuera de rango (máximo ×4).");
      let dw = Math.round(w * o.scale), dh = Math.round(h * o.scale);
      const k = Math.min(1, MAX_EDGE / Math.max(dw, dh));
      dw = Math.max(1, Math.round(dw * k)); dh = Math.max(1, Math.round(dh * k));
      return { ...base, dw, dh, outW: dw, outH: dh };
    }
    case "convert": return { ...base, mime: o.mime, quality: Math.min(1, Math.max(0.3, o.quality ?? 0.9)) };
  }
}

export const extFor = (mime: string) => (mime === "image/jpeg" ? "jpg" : mime.split("/")[1] ?? "png");

/** Browser/WebView executor using canvas (Android WebView supports PNG/JPEG/WEBP encoding). */
export async function applyOp(bytes: Uint8Array, mime: string, o: ImageOp): Promise<{ bytes: Uint8Array; mime: string; width: number; height: number }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const p = planOp(bmp.width, bmp.height, mime, o);
    const canvas = document.createElement("canvas");
    canvas.width = p.outW; canvas.height = p.outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("El dispositivo no permitió crear el lienzo de imagen.");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    if (p.mime === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, p.outW, p.outH); } // JPEG has no transparency
    ctx.translate(p.outW / 2, p.outH / 2);
    ctx.rotate((p.rotate * Math.PI) / 180);
    ctx.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
    ctx.drawImage(bmp, p.sx, p.sy, p.sw, p.sh, -p.dw / 2, -p.dh / 2, p.dw, p.dh);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, p.mime, p.quality));
    if (!blob) throw new Error("No se pudo codificar la imagen.");
    if (blob.type && blob.type !== p.mime) throw new Error(`Este dispositivo no puede guardar en ${p.mime}.`);
    canvas.width = canvas.height = 0; // free canvas memory immediately
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: p.mime, width: p.outW, height: p.outH };
  } finally { bmp.close(); }
}

export function describeOp(o: ImageOp) {
  switch (o.op) {
    case "rotate": return `Rotar ${o.deg}°`;
    case "flip": return o.axis === "h" ? "Voltear horizontal" : "Voltear vertical";
    case "crop": return `Recortar ${o.aspect}`;
    case "resize": return `Escalar ×${o.scale}`;
    case "convert": return `Convertir a ${extFor(o.mime).toUpperCase()}`;
  }
}
