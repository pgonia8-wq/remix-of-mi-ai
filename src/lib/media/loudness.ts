// Loudness metering per ITU-R BS.1770-4 / EBU R128 (K-weighting, 400 ms gated integrated loudness,
// 3 s short-term, EBU Tech 3342 loudness range) and 4x-oversampled true-peak (BS.1770-4 Annex 2 FIR).
// Pure local computation on PCM; no network. Results are measurements of this implementation, not a
// third-party certification.
import type { PcmAudio } from "../audio-edit";

export type Loudness = { integratedLufs: number; shortTermMaxLufs: number; momentaryMaxLufs: number; lraLu: number; truePeakDbtp: number; samplePeakDbfs: number };
export type LoudnessTarget = { id: string; label: string; lufs: number; truePeak: number };
export const LOUDNESS_TARGETS: LoudnessTarget[] = [
  { id: "spotify", label: "Spotify / YouTube (−14 LUFS, −1 dBTP)", lufs: -14, truePeak: -1 },
  { id: "apple", label: "Apple Music / Podcast (−16 LUFS, −1 dBTP)", lufs: -16, truePeak: -1 },
  { id: "amazon", label: "Amazon Music (−14 LUFS, −2 dBTP)", lufs: -14, truePeak: -2 },
  { id: "club", label: "Club / máster fuerte (−9 LUFS, −1 dBTP)", lufs: -9, truePeak: -1 },
  { id: "ebu", label: "Broadcast EBU R128 (−23 LUFS, −1 dBTP)", lufs: -23, truePeak: -1 },
];

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };
/** K-weighting coefficients for any sample rate (pre-filter shelf + RLB high-pass). */
export function kWeighting(fs: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416, a0 = 1 + K / Q + K * K;
  const shelf = { b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs);
  const d = 1 + K / Q + K * K;
  const hp = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / d, a2: (1 - K / Q + K * K) / d };
  return [shelf, hp];
}
function filter(x: Float32Array, f: Biquad) {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i] ?? 0, o = f.b0 * v + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; }
  return y;
}
const toLufs = (power: number) => power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
/** Mean-square power of K-weighted blocks (channel weights 1.0 for L/R/mono). */
function blockPowers(weighted: Float32Array[], fs: number, windowSec: number, stepSec: number) {
  const len = weighted[0]?.length ?? 0, win = Math.round(windowSec * fs), step = Math.round(stepSec * fs), out: number[] = [];
  if (len < win) { if (len > 0) { let s = 0; for (const ch of weighted) { let c = 0; for (let i = 0; i < len; i++) c += (ch[i] ?? 0) ** 2; s += c / len; } out.push(s); } return out; }
  // Prefix sums per channel make each block O(1).
  const prefix = weighted.map((ch) => { const p = new Float64Array(len + 1); for (let i = 0; i < len; i++) p[i + 1] = (p[i] ?? 0) + (ch[i] ?? 0) ** 2; return p; });
  for (let start = 0; start + win <= len; start += step) { let s = 0; for (const p of prefix) s += ((p[start + win] ?? 0) - (p[start] ?? 0)) / win; out.push(s); }
  return out;
}
function gatedMean(powers: number[], relativeLu: number) {
  const abs = powers.filter((p) => toLufs(p) > -70);
  if (!abs.length) return { power: 0, kept: [] as number[] };
  const rel = toLufs(abs.reduce((a, b) => a + b, 0) / abs.length) + relativeLu;
  const kept = abs.filter((p) => toLufs(p) > rel);
  return { power: kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : 0, kept };
}
// BS.1770-4 Annex 2: 48-tap, 4-phase interpolation filter.
const TP_PHASES = [
  [0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.0266113281250, 0.0148925781250, -0.00830078125],
  [-0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375],
  [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625, 0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875],
  [-0.00830078125, 0.0148925781250, -0.0266113281250, 0.047607421875, -0.102294921875, 0.97216796875, 0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375],
];
const TP_DELAY = 6;
/** Per-sample true-peak envelope (max of the sample and its 4x-interpolated neighbours), linked across channels. */
export function truePeakEnvelope(a: PcmAudio) {
  const len = a.channels[0]?.length ?? 0, env = new Float32Array(len);
  for (const ch of a.channels) for (let n = 0; n < len + TP_DELAY; n++) {
    let peak = 0;
    for (const h of TP_PHASES) { let y = 0; for (let j = 0; j < 12; j++) { const idx = n - j; if (idx >= 0 && idx < len) y += (h[j] ?? 0) * (ch[idx] ?? 0); } peak = Math.max(peak, Math.abs(y)); }
    const m = n - TP_DELAY;
    if (m >= 0 && m < len) env[m] = Math.max(env[m] ?? 0, peak, Math.abs(ch[m] ?? 0));
    if (m + 1 >= 0 && m + 1 < len) env[m + 1] = Math.max(env[m + 1] ?? 0, peak);
  }
  return env;
}
const db = (v: number) => v > 0 ? 20 * Math.log10(v) : -Infinity;
export function measureLoudness(a: PcmAudio): Loudness {
  const fs = a.sampleRate, len = a.channels[0]?.length ?? 0;
  if (!len || !Number.isFinite(fs) || fs < 8000 || a.channels.length < 1 || a.channels.length > 2) throw new Error("Audio no medible (1–2 canales, ≥8 kHz).");
  const [shelf, hp] = kWeighting(fs), weighted = a.channels.map((ch) => filter(filter(ch, shelf), hp));
  const momentary = blockPowers(weighted, fs, 0.4, 0.1), short = blockPowers(weighted, fs, 3, 0.1);
  const integrated = toLufs(gatedMean(momentary, -10).power);
  const lraBlocks = gatedMean(short, -20).kept.map(toLufs).sort((x, y) => x - y);
  const pct = (q: number) => lraBlocks[Math.min(lraBlocks.length - 1, Math.max(0, Math.round(q * (lraBlocks.length - 1))))] ?? 0;
  let sample = 0; for (const ch of a.channels) for (let i = 0; i < len; i++) sample = Math.max(sample, Math.abs(ch[i] ?? 0));
  let tp = 0; for (const v of truePeakEnvelope(a)) tp = Math.max(tp, v);
  return { integratedLufs: integrated, momentaryMaxLufs: Math.max(...momentary.map(toLufs)), shortTermMaxLufs: Math.max(...short.map(toLufs)), lraLu: lraBlocks.length > 1 ? pct(0.95) - pct(0.1) : 0, truePeakDbtp: db(tp), samplePeakDbfs: db(sample) };
}
function applyGain(a: PcmAudio, gainDb: number): PcmAudio { const g = 10 ** (gainDb / 20); return { sampleRate: a.sampleRate, channels: a.channels.map((ch) => ch.map((v) => v * g)) }; }
/** Linked look-ahead limiter driven by the true-peak envelope; re-measures and tightens until the ceiling holds. */
export function truePeakLimit(a: PcmAudio, ceilingDbtp: number, lookaheadMs = 5): PcmAudio {
  if (!Number.isFinite(ceilingDbtp) || ceilingDbtp > 0 || ceilingDbtp < -12) throw new Error("Techo true-peak inválido (−12 a 0 dBTP).");
  let target = ceilingDbtp, out = a;
  for (let pass = 0; pass < 4; pass++) {
    const env = truePeakEnvelope(a), len = env.length, ceiling = 10 ** (target / 20), ahead = Math.max(1, Math.ceil(a.sampleRate * lookaheadMs / 1000));
    // Sliding maximum over the look-ahead window (monotonic deque).
    const maxima = new Float32Array(len), q: number[] = []; let head = 0, next = 0;
    for (let i = 0; i < len; i++) { while (next < len && next <= i + ahead) { while (q.length > head && (env[q[q.length - 1]!] ?? 0) <= (env[next] ?? 0)) q.pop(); q.push(next++); } while (head < q.length && q[head]! < i - ahead) head++; maxima[i] = env[q[head] ?? i] ?? 0; }
    const release = Math.exp(-1 / (0.1 * a.sampleRate));
    let gain = 1; const gains = new Float32Array(len);
    for (let i = 0; i < len; i++) { const wanted = Math.min(1, ceiling / Math.max(ceiling, maxima[i] ?? 0)); gain = wanted < gain ? wanted : wanted + (gain - wanted) * release; gains[i] = gain; }
    out = { sampleRate: a.sampleRate, channels: a.channels.map((ch) => ch.map((v, i) => v * (gains[i] ?? 1))) };
    let tp = 0; for (const v of truePeakEnvelope(out)) tp = Math.max(tp, v);
    const over = db(tp) - ceilingDbtp;
    if (over <= 0.01) return out;
    target -= over + 0.05;
  }
  return out;
}
/** Normalizes integrated loudness to a target, then holds the true-peak ceiling. Returns the measured result. */
export function normalizeLoudness(a: PcmAudio, target: { lufs: number; truePeak: number }) {
  if (!Number.isFinite(target.lufs) || target.lufs < -40 || target.lufs > -5) throw new Error("Objetivo LUFS inválido (−40 a −5).");
  const before = measureLoudness(a);
  if (!Number.isFinite(before.integratedLufs)) throw new Error("Audio demasiado silencioso para normalizar.");
  let gain = target.lufs - before.integratedLufs, out = a, after = before;
  for (let i = 0; i < 3; i++) {
    out = truePeakLimit(applyGain(a, Math.min(gain, 36)), target.truePeak);
    after = measureLoudness(out);
    const miss = target.lufs - after.integratedLufs;
    if (Math.abs(miss) < 0.3) break;
    gain += miss;
  }
  return { audio: out, before, after, reachedTarget: Math.abs(target.lufs - after.integratedLufs) < 0.5 && after.truePeakDbtp <= target.truePeak + 0.01 };
}
