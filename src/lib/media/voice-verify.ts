// Voice-ownership check before cloning: a live random phrase (liveness), its transcription (it was really read now)
// and an on-device acoustic comparison between that live recording and every sample (same speaker).
// It is a strong practical check, not forensic proof; thresholds are conservative and the scores are shown.
import type { PcmAudio } from "../audio-edit";

const WORDS = ["río", "montaña", "ventana", "naranja", "lápiz", "camino", "estrella", "puerta", "jardín", "trueno", "brújula", "pelota", "violeta", "nube", "faro", "cometa", "tambor", "espejo", "bosque", "galleta"];
/** Random phrase with three words and a 4-digit number; it cannot be prepared in advance. */
export function challengePhrase(rand: () => number = Math.random) {
  const pick = () => WORDS[Math.floor(rand() * WORDS.length)]!;
  const n = 1000 + Math.floor(rand() * 9000);
  return `Soy yo, mi código es ${n}, ${pick()}, ${pick()} y ${pick()}.`;
}
const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").split(/\s+/).filter(Boolean);
const NUM_WORDS: Record<string, string> = { mil: "", cero: "0" };
/** Fraction of the phrase's words that appear in the transcript; the number must be present (as digits). */
export function phraseMatch(expected: string, transcript: string) {
  const exp = norm(expected), got = new Set(norm(transcript).filter((w) => !(w in NUM_WORDS)));
  const digits = expected.match(/\d{4}/)?.[0] ?? "";
  const tDigits = transcript.replace(/[\s.,]/g, "");
  const numberOk = !digits || tDigits.includes(digits);
  const words = exp.filter((w) => !/^\d+$/.test(w));
  const score = words.length ? words.filter((w) => got.has(w)).length / words.length : 0;
  return { score, numberOk, ok: numberOk && score >= 0.7 };
}

// ---------- acoustic voiceprint (MFCC statistics + pitch), pure TypeScript ----------
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const a = i + k, b = a + len / 2, tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr;
      re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
      const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
    } }
  }
}
const mel = (f: number) => 2595 * Math.log10(1 + f / 700), imel = (m: number) => 700 * (10 ** (m / 2595) - 1);
export type Voiceprint = { mfcc: number[]; f0: number; frames: number };

export function mono16k(a: PcmAudio): Float32Array {
  const ch = a.channels; const n = ch[0]?.length ?? 0; const m = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const c of ch) s += c[i] ?? 0; m[i] = s / ch.length; }
  if (a.sampleRate === 16000) return m;
  const ratio = a.sampleRate / 16000, out = new Float32Array(Math.floor(n / ratio));
  for (let i = 0; i < out.length; i++) { const x = i * ratio, k = Math.floor(x), f = x - k; out[i] = (m[k] ?? 0) * (1 - f) + (m[k + 1] ?? m[k] ?? 0) * f; }
  return out;
}

/** 13 MFCC means/deviations over voiced frames plus median pitch (autocorrelation, 70–400 Hz). */
export function voiceprint(x: Float32Array, sr = 16000): Voiceprint {
  const N = 512, hop = 160, win = 400, bands = 26, coefs = 13;
  const hamming = Float64Array.from({ length: win }, (_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (win - 1)));
  const lo = mel(80), hi = mel(7600), pts = Array.from({ length: bands + 2 }, (_, i) => Math.floor((N + 1) * imel(lo + (hi - lo) * i / (bands + 1)) / sr));
  const energies: number[] = []; for (let s = 0; s + win <= x.length; s += hop) { let e = 0; for (let i = 0; i < win; i++) e += x[s + i]! ** 2; energies.push(e / win); }
  const sorted = [...energies].sort((a, b) => a - b), thr = Math.max(1e-9, (sorted[Math.floor(sorted.length * 0.9)] ?? 0) * 0.1);
  const feats: number[][] = [], pitches: number[] = [];
  energies.forEach((e, f) => {
    if (e < thr) return;
    const s = f * hop, re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < win; i++) re[i] = (x[s + i]! - 0.97 * (x[s + i - 1] ?? 0)) * hamming[i]!;
    fft(re, im);
    const pow = Array.from({ length: N / 2 + 1 }, (_, k) => (re[k]! ** 2 + im[k]! ** 2) / N);
    const fb = Array.from({ length: bands }, (_, m) => { let sum = 0; for (let k = pts[m]!; k < pts[m + 2]!; k++) { const w = k < pts[m + 1]! ? (k - pts[m]!) / Math.max(1, pts[m + 1]! - pts[m]!) : (pts[m + 2]! - k) / Math.max(1, pts[m + 2]! - pts[m + 1]!); sum += w * (pow[k] ?? 0); } return Math.log(sum + 1e-10); });
    feats.push(Array.from({ length: coefs }, (_, c) => fb.reduce((acc, v, m) => acc + v * Math.cos(Math.PI * (c + 1) * (m + 0.5) / bands), 0)));
    // pitch by normalized autocorrelation
    let best = 0, lag = 0; for (let L = Math.floor(sr / 400); L <= Math.floor(sr / 70); L++) { let num = 0, d1 = 0, d2 = 0; for (let i = 0; i + L < win; i++) { const a = x[s + i]!, b = x[s + i + L]!; num += a * b; d1 += a * a; d2 += b * b; } const r = num / Math.sqrt(d1 * d2 + 1e-12); if (r > best) { best = r; lag = L; } }
    if (best > 0.5 && lag) pitches.push(sr / lag);
  });
  if (feats.length < 20) throw new Error("La grabación tiene muy poca voz clara. Graba más cerca del micrófono y sin ruido.");
  const mean = Array.from({ length: coefs }, (_, c) => feats.reduce((s, f) => s + f[c]!, 0) / feats.length);
  const sd = Array.from({ length: coefs }, (_, c) => Math.sqrt(feats.reduce((s, f) => s + (f[c]! - mean[c]!) ** 2, 0) / feats.length));
  const ps = pitches.sort((a, b) => a - b);
  return { mfcc: [...mean, ...sd], f0: ps.length ? ps[Math.floor(ps.length / 2)]! : 0, frames: feats.length };
}

/** Same-speaker score in [0,1] from MFCC statistics (cosine) and pitch closeness. */
export function compareVoiceprints(a: Voiceprint, b: Voiceprint) {
  const dot = a.mfcc.reduce((s, v, i) => s + v * b.mfcc[i]!, 0), na = Math.hypot(...a.mfcc), nb = Math.hypot(...b.mfcc);
  const timbre = na && nb ? (dot / (na * nb) + 1) / 2 : 0;
  const ratio = a.f0 && b.f0 ? Math.max(a.f0, b.f0) / Math.min(a.f0, b.f0) : 1;
  const pitch = Math.max(0, 1 - Math.log2(ratio) * 2); // one octave apart → 0
  const score = 0.6 * timbre + 0.4 * pitch;
  return { score: Math.round(score * 1000) / 1000, timbre: Math.round(timbre * 1000) / 1000, pitchRatio: Math.round(ratio * 100) / 100, ok: score >= 0.8 && ratio <= 1.3 };
}
