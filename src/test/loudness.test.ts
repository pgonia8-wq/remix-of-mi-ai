import { expect, it } from "vitest";
import { measureLoudness, normalizeLoudness, truePeakLimit } from "@/lib/media/loudness";
const sine = (amp: number, freq: number, fs = 48000, seconds = 5, phase = 0) => { const n = fs * seconds, ch = new Float32Array(n); for (let i = 0; i < n; i++) ch[i] = amp * Math.sin(2 * Math.PI * freq * i / fs + phase); return ch; };
it("997 Hz stereo sine at −20 dBFS measures −20 LUFS (BS.1770 reference)", () => {
  const amp = 10 ** (-20 / 20), ch = sine(amp, 997);
  const m = measureLoudness({ sampleRate: 48000, channels: [ch, ch.slice()] });
  expect(m.integratedLufs).toBeCloseTo(-20, 0);
  expect(Math.abs(m.integratedLufs + 20)).toBeLessThan(0.15);
  expect(m.lraLu).toBeLessThan(0.5);
});
it("true peak detects inter-sample peaks that sample peak misses", () => {
  const ch = sine(1, 12000, 48000, 1, Math.PI / 4); // samples land at ±0.707
  const m = measureLoudness({ sampleRate: 48000, channels: [ch] });
  expect(m.samplePeakDbfs).toBeCloseTo(-3.01, 1);
  expect(m.truePeakDbtp).toBeGreaterThan(-0.6);
});
it("true-peak limiter holds the ceiling", () => {
  const ch = sine(1, 12000, 48000, 1, Math.PI / 4);
  const out = truePeakLimit({ sampleRate: 48000, channels: [ch] }, -6);
  expect(measureLoudness(out).truePeakDbtp).toBeLessThanOrEqual(-5.99);
});
it("normalizes to −14 LUFS with ≤ −1 dBTP", () => {
  const ch = sine(0.05, 440, 48000, 6);
  const r = normalizeLoudness({ sampleRate: 48000, channels: [ch, ch.slice()] }, { lufs: -14, truePeak: -1 });
  expect(Math.abs(r.after.integratedLufs + 14)).toBeLessThan(0.5);
  expect(r.after.truePeakDbtp).toBeLessThanOrEqual(-0.99);
  expect(r.reachedTarget).toBe(true);
});
it("rejects silent audio and out-of-range targets", () => {
  const silent = { sampleRate: 48000, channels: [new Float32Array(48000)] };
  expect(() => normalizeLoudness(silent, { lufs: -14, truePeak: -1 })).toThrow();
  expect(() => normalizeLoudness({ sampleRate: 48000, channels: [sine(0.1, 440)] }, { lufs: 0, truePeak: -1 })).toThrow();
});
