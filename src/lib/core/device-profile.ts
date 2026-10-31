// Adaptive performance profile from MEASURED device facts — never from the commercial model name.
// Crypto is identical for all profiles; only block size, buffers and concurrency change.
export type DeviceFacts = {
  availMemMB: number | null; totalMemMB: number | null; lowMemory: boolean | null; cores: number | null; abis: string[];
  freeStorageMB: number | null; batteryPct: number | null; charging: boolean | null; thermal: number | null; // 0 none … 6 shutdown
  strongBox: boolean | null; manufacturer?: string; model?: string; sdk?: number; source: "native" | "browser";
};
export type ProfileName = "economico" | "intermedio" | "alto";
export type PerfProfile = { name: ProfileName; blockSize: number; concurrency: number; reasons: string[] };

const MB = 1024 * 1024;

export function chooseProfile(f: DeviceFacts): PerfProfile {
  const reasons: string[] = [];
  const mem = f.availMemMB, cores = f.cores ?? 1;
  let name: ProfileName = "economico";
  if (mem !== null && mem >= 3000 && cores >= 8) name = "alto";
  else if (mem !== null && mem >= 1200 && cores >= 4) name = "intermedio";
  reasons.push(mem === null ? "memoria disponible desconocida" : `memoria disponible ${Math.round(mem)} MB`, `${cores} núcleos`);
  // Conditions that force a lower profile regardless of hardware class.
  const down = (why: string) => { reasons.push(why); name = name === "alto" ? "intermedio" : "economico"; };
  if (f.lowMemory) down("Android reporta memoria baja");
  if (f.thermal !== null && f.thermal >= 2) down(`estado térmico ${f.thermal}`);
  if (f.batteryPct !== null && f.batteryPct < 20 && !f.charging) down(`batería ${f.batteryPct}% sin cargar`);
  if (f.freeStorageMB !== null && f.freeStorageMB < 500) down("poco espacio libre");
  if (mem === null) { name = "economico"; reasons.push("sin datos fiables: se usa el perfil económico"); }
  const table: Record<ProfileName, [number, number]> = { economico: [1 * MB, 1], intermedio: [2 * MB, 2], alto: [4 * MB, 4] };
  const [blockSize, concurrency] = table[name];
  return { name, blockSize, concurrency, reasons };
}

/** Runtime tuning: if a block takes too long (thermal throttling / memory pressure proxy), reduce concurrency. */
export class Tuner {
  private slow = 0;
  constructor(public profile: PerfProfile) {}
  observe(ms: number) {
    if (ms > 400) this.slow++; else this.slow = Math.max(0, this.slow - 1);
    if (this.slow >= 3 && this.profile.concurrency > 1) { this.profile = { ...this.profile, concurrency: this.profile.concurrency - 1, reasons: [...this.profile.reasons, "concurrencia reducida por bloques lentos"] }; this.slow = 0; }
  }
}

type NativeInfo = Partial<DeviceFacts>;

export async function detectDevice(native?: () => Promise<NativeInfo>): Promise<DeviceFacts> {
  if (native) {
    try { const n = await native(); return { availMemMB: null, totalMemMB: null, lowMemory: null, cores: null, abis: [], freeStorageMB: null, batteryPct: null, charging: null, thermal: null, strongBox: null, ...n, source: "native" }; } catch { /* fall through */ }
  }
  const nav = (typeof navigator !== "undefined" ? navigator : {}) as Navigator & { deviceMemory?: number; getBattery?: () => Promise<{ level: number; charging: boolean }> };
  let batteryPct: number | null = null, charging: boolean | null = null, free: number | null = null;
  try { const b = await nav.getBattery?.(); if (b) { batteryPct = Math.round(b.level * 100); charging = b.charging; } } catch { /* not exposed */ }
  try { const e = await nav.storage?.estimate?.(); if (e?.quota !== undefined) free = Math.round(((e.quota ?? 0) - (e.usage ?? 0)) / MB); } catch { /* not exposed */ }
  return {
    availMemMB: nav.deviceMemory ? nav.deviceMemory * 1024 * 0.5 : null, totalMemMB: nav.deviceMemory ? nav.deviceMemory * 1024 : null, lowMemory: null,
    cores: nav.hardwareConcurrency ?? null, abis: [], freeStorageMB: free, batteryPct, charging, thermal: null, strongBox: null, source: "browser",
  };
}
