import { useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "./ui/button";
import { dropIndex, reorder, segments, trim, type TClip } from "@/lib/media/timeline";

type Drag = { kind: "move" | "start" | "end"; index: number; x0: number; dx: number; pointer: number };
/** Drag clips to reorder, drag their edges to trim, tap the ruler to move the playhead. */
export function VideoTimeline<T extends TClip & { name: string }>({ clips, onChange, playhead, onSeek }: { clips: T[]; onChange: (c: T[]) => void; playhead: number; onSeek: (t: number) => void }) {
  const [pps, setPps] = useState(40), [drag, setDrag] = useState<Drag | null>(null), strip = useRef<HTMLDivElement | null>(null);
  const { list, duration } = segments(clips), width = Math.max(duration * pps + 48, 280);
  const xOf = (e: React.PointerEvent) => e.clientX - (strip.current?.getBoundingClientRect().left ?? 0) + (strip.current?.scrollLeft ?? 0);
  function begin(e: React.PointerEvent, kind: Drag["kind"], index: number) { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ kind, index, x0: e.clientX, dx: 0, pointer: xOf(e) }); }
  function move(e: React.PointerEvent) { if (drag) setDrag({ ...drag, dx: e.clientX - drag.x0, pointer: xOf(e) }); }
  function end() {
    if (!drag) return;
    const c = clips[drag.index];
    if (c && drag.kind === "move" && Math.abs(drag.dx) > 6) { const centres = list.filter((s) => s.index !== drag.index).map((s) => (s.at + s.length / 2) * pps); onChange(reorder(clips, drag.index, dropIndex(centres, drag.pointer))); }
    else if (c && drag.kind !== "move") onChange(clips.map((x, i) => i === drag.index ? trim(x, drag.kind as "start" | "end", drag.dx / pps) : x));
    setDrag(null);
  }
  return <div className="space-y-2" aria-label="Línea de tiempo arrastrable">
    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Arrastra un clip para reordenarlo · arrastra sus bordes para recortarlo</span><span className="flex gap-1"><Button size="icon" variant="ghost" aria-label="Alejar línea de tiempo" onClick={() => setPps(Math.max(8, pps / 1.5))}><ZoomOut /></Button><Button size="icon" variant="ghost" aria-label="Acercar línea de tiempo" onClick={() => setPps(Math.min(240, pps * 1.5))}><ZoomIn /></Button></span></div>
    <div ref={strip} className="relative overflow-x-auto rounded-xl border bg-card" onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
      <div className="relative h-24 touch-none select-none" style={{ width }}>
        <div className="absolute inset-x-0 top-0 h-5 cursor-pointer border-b" role="slider" aria-label="Regla de tiempo" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={playhead} tabIndex={0} onKeyDown={(e) => { if (e.key === "ArrowRight") onSeek(Math.min(duration, playhead + 0.5)); if (e.key === "ArrowLeft") onSeek(Math.max(0, playhead - 0.5)); }} onPointerDown={(e) => onSeek(Math.min(duration, Math.max(0, xOf(e) / pps)))}>
          {Array.from({ length: Math.ceil(duration) + 1 }, (_, s) => <span key={s} className="absolute top-0 h-5 border-l pl-0.5 text-[10px] text-muted-foreground" style={{ left: s * pps }}>{s % Math.max(1, Math.round(40 / pps)) === 0 ? `${s}s` : ""}</span>)}
        </div>
        {list.map((s) => {
          const c = clips[s.index]!, active = drag?.index === s.index; let left = s.at * pps, w = s.length * pps;
          if (active && drag.kind === "move") left += drag.dx;
          if (active && drag.kind === "start") { const t = trim(c, "start", drag.dx / pps); left += (t.start - c.start) * pps; w = (t.end - t.start) * pps; }
          if (active && drag.kind === "end") { const t = trim(c, "end", drag.dx / pps); w = (t.end - t.start) * pps; }
          return <div key={c.assetId + s.index} className={`absolute top-7 flex h-14 items-center overflow-hidden rounded-lg border text-xs ${active ? "z-10 border-primary bg-primary/30 shadow-lg" : "border-primary/40 bg-primary/15"}`} style={{ left, width: Math.max(w, 24) }} onPointerDown={(e) => begin(e, "move", s.index)} aria-label={`Clip ${s.index + 1}: ${c.name}`}>
            <span className="absolute inset-y-0 left-0 w-3 cursor-ew-resize bg-primary/50" aria-label={`Recortar inicio clip ${s.index + 1}`} onPointerDown={(e) => begin(e, "start", s.index)} />
            {s.overlap > 0 && <span className="absolute inset-y-0 left-3 bg-info/30" style={{ width: s.overlap * pps }} title={`Transición ${s.transition}`} />}
            <span className="pointer-events-none truncate px-4">{s.index + 1} · {c.name} · {s.length.toFixed(1)}s</span>
            <span className="absolute inset-y-0 right-0 w-3 cursor-ew-resize bg-primary/50" aria-label={`Recortar final clip ${s.index + 1}`} onPointerDown={(e) => begin(e, "end", s.index)} />
          </div>;
        })}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-warning" style={{ left: playhead * pps }} />
      </div>
    </div>
  </div>;
}
