// @vitest-environment node
import { it, expect } from "vitest";
import { captionsSrt, validateTimeline } from "@/lib/video-edit";
const clip = { assetId: "x", name: "clip", start: 2, end: 6, duration: 10 };
it("suma intervalos y rechaza recortes fuera del clip", () => { expect(validateTimeline([clip, clip], [])).toBe(8); expect(() => validateTimeline([{ ...clip, end: 11 }], [])).toThrow(); });
it("subtítulos deben quedar en la duración exportada", () => { expect(() => validateTimeline([clip], [{ start: 0, end: 5, text: "hola" }])).toThrow(); expect(captionsSrt([{ start: 1.25, end: 2.5, text: "Hola" }])).toBe("1\n00:00:01,250 --> 00:00:02,500\nHola\n"); });