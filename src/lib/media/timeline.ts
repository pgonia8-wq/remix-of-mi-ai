// Timeline math shared by the drag timeline and the composite preview. Timing matches the FFmpeg plan in
// pc-node/media-plan.mjs: each transition overlaps the previous clip by its duration (xfade offset).
export type TClip = { assetId: string; start: number; end: number; duration: number; transition?: string; transitionSeconds?: number };
export type TOverlay = { assetId: string; offset: number; length: number; scale: number; x: number; y: number; endX: number; endY: number };
export type Segment = { index: number; at: number; length: number; transition: string; overlap: number };

export function segments(clips: TClip[]): { list: Segment[]; duration: number } {
  const list: Segment[] = []; let duration = 0;
  clips.forEach((c, i) => {
    const length = Math.max(0, c.end - c.start), prevLen = i ? Math.max(0, clips[i - 1]!.end - clips[i - 1]!.start) : 0;
    const wanted = i === 0 || !c.transition || c.transition === "cut" ? 0 : (c.transitionSeconds ?? 0.5);
    const overlap = Math.max(0, Math.min(wanted, length - 0.05, prevLen - 0.05));
    const at = i === 0 ? 0 : duration - overlap;
    list.push({ index: i, at, length, transition: overlap > 0 ? (c.transition ?? "cut") : "cut", overlap });
    duration = at + length;
  });
  return { list, duration };
}
/** What to draw at time t: one clip, or two with transition progress 0→1. */
export function frameAt(clips: TClip[], t: number) {
  const { list } = segments(clips);
  const active = list.filter((s) => t >= s.at && t < s.at + s.length);
  if (!active.length) { const last = list[list.length - 1]; return last && t >= last.at ? { a: { seg: last, local: clips[last.index]!.start + Math.min(t - last.at, last.length - 0.001) }, b: null, progress: 0 } : null; }
  const b = active.length > 1 ? active[active.length - 1]! : null, a = active[0]!;
  const local = (s: Segment) => clips[s.index]!.start + (t - s.at);
  return { a: { seg: a, local: local(a) }, b: b ? { seg: b, local: local(b) } : null, progress: b ? Math.min(1, (t - b.at) / Math.max(b.overlap, 1e-3)) : 0 };
}
export function overlayAt(o: TOverlay, t: number) {
  if (t < o.offset || t > o.offset + o.length) return null;
  const u = Math.min(1, Math.max(0, (t - o.offset) / Math.max(o.length, 1e-3)));
  return { x: o.x + (o.endX - o.x) * u, y: o.y + (o.endY - o.y) * u, scale: o.scale, local: t - o.offset };
}
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list], [item] = next.splice(from, 1); next.splice(Math.max(0, Math.min(to, next.length)), 0, item!); return next;
}
/** Trims one edge by a time delta, keeping at least `min` seconds and staying inside the source media. */
export function trim<T extends TClip>(c: T, edge: "start" | "end", delta: number, min = 0.2): T {
  if (edge === "start") return { ...c, start: Math.min(Math.max(0, c.start + delta), c.end - min) };
  return { ...c, end: Math.max(Math.min(c.duration, c.end + delta), c.start + min) };
}
/** Index where a dragged item should land, from the pointer x and the item centres. */
export function dropIndex(centres: number[], x: number) { let i = 0; while (i < centres.length && x > centres[i]!) i++; return i; }
