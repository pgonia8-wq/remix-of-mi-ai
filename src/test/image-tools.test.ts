import { describe, it, expect } from "vitest";
import { planOp, MAX_EDGE } from "@/lib/core/image-tools";

describe("on-device image tools", () => {
  it("rotate 90 swaps dimensions, 180 keeps them", () => {
    expect(planOp(1200, 800, "image/png", { op: "rotate", deg: 90 })).toMatchObject({ outW: 800, outH: 1200 });
    expect(planOp(1200, 800, "image/png", { op: "rotate", deg: 180 })).toMatchObject({ outW: 1200, outH: 800 });
  });
  it("center crop to 1:1 and 16:9", () => {
    expect(planOp(1200, 800, "image/png", { op: "crop", aspect: "1:1" })).toMatchObject({ sx: 200, sy: 0, sw: 800, sh: 800, outW: 800 });
    expect(planOp(1000, 1000, "image/png", { op: "crop", aspect: "16:9" })).toMatchObject({ sw: 1000, sh: 563, sy: 218 });
  });
  it("resize ×2 is capped at the max edge for low-RAM phones", () => {
    expect(planOp(500, 400, "image/png", { op: "resize", scale: 2 })).toMatchObject({ outW: 1000, outH: 800 });
    const p = planOp(3000, 1500, "image/png", { op: "resize", scale: 2 });
    expect(p.outW).toBe(MAX_EDGE);
    expect(p.outH).toBe(2048);
    expect(() => planOp(10, 10, "image/png", { op: "resize", scale: 5 })).toThrow();
  });
  it("convert sets target format and clamps quality; GIF output becomes PNG", () => {
    expect(planOp(10, 10, "image/png", { op: "convert", mime: "image/jpeg", quality: 0.1 })).toMatchObject({ mime: "image/jpeg", quality: 0.3 });
    expect(planOp(10, 10, "image/gif", { op: "flip", axis: "h" }).mime).toBe("image/png");
  });
  it("rejects invalid dimensions", () => {
    expect(() => planOp(0, 10, "image/png", { op: "flip", axis: "v" })).toThrow();
  });
});
