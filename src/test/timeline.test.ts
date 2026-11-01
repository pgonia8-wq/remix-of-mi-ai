import { expect, it } from "vitest";
import { dropIndex, frameAt, overlayAt, reorder, segments, trim } from "@/lib/media/timeline";
import { videoArgs } from "../../pc-node/media-plan.mjs";
const clip = (id: string, len: number, transition = "cut", transitionSeconds = 0.5) => ({ assetId: id, name: id, start: 1, end: 1 + len, duration: 30, transition, transitionSeconds });
it("timeline duration matches the FFmpeg render plan", () => {
  const clips = [clip("a", 4), clip("b", 3, "fade", 1), clip("c", 5, "wipeleft", 0.5)] as const;
  const plan = { clips: [...clips], overlays: [], width: 1280, height: 720, rotation: 0, mute: true, originalAudio: false, captions: [] };
  expect(segments([...clips]).duration).toBeCloseTo(videoArgs(plan, ["a", "b", "c"], "o.mp4").duration);
  expect(segments([...clips]).duration).toBeCloseTo(10.5);
});
it("frameAt reports both clips and progress during a transition", () => {
  const clips = [clip("a", 4), clip("b", 3, "fade", 1)];
  const f = frameAt(clips, 3.5)!;
  expect(f.a.seg.index).toBe(0); expect(f.b?.seg.index).toBe(1); expect(f.progress).toBeCloseTo(0.5);
  expect(f.b!.local).toBeCloseTo(1.5); // source time inside clip b (start 1 + 0.5)
  expect(frameAt(clips, 1)!.b).toBeNull();
});
it("overlay keyframes interpolate position inside their window only", () => {
  const o = { assetId: "p", offset: 2, length: 4, scale: 0.3, x: 0, y: 0, endX: 1, endY: 0.5 };
  expect(overlayAt(o, 4)).toMatchObject({ x: 0.5, y: 0.25 }); expect(overlayAt(o, 1)).toBeNull(); expect(overlayAt(o, 7)).toBeNull();
});
it("drag helpers reorder, trim within the source and compute drop slots", () => {
  expect(reorder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  const c = clip("a", 4);
  expect(trim(c, "start", -5).start).toBe(0);
  expect(trim(c, "start", 10).start).toBeCloseTo(c.end - 0.2);
  expect(trim(c, "end", 100).end).toBe(30);
  expect(dropIndex([50, 150, 250], 160)).toBe(2);
});
