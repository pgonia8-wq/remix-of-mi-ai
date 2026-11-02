// Background driver: keeps an autonomous run advancing on its own (no button presses) until it needs a person
// (approval, review, budget) or finishes. One driver per run per app session; stepRun stays the only executor.
import type { Core } from "../core";
import { stepRun, type ModelCall } from "./orchestrator";

const driving = new Set<string>();
/** Platform hooks (installed by the app shell): background-work notice, settle notifications and a pause that is not
 * throttled while the screen is off. Hooks never execute tools; stepRun remains the only executor. */
export type DriveHooks = { busy?(active: number): void; idle?(): void; settled?(p: string, id: string, status: string, goal: string): void; pause?(ms: number): Promise<void> };
let hooks: DriveHooks = {};
export function setDriveHooks(h: DriveHooks) { hooks = h; }
const safe = (f: () => void) => { try { f(); } catch { /* platform hooks never stop a run */ } };
const listeners = new Set<(runId: string) => void>();
export const isDriving = (p: string, id: string) => driving.has(`${p}:${id}`);
export function onRunProgress(cb: (runId: string) => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
const notify = (id: string) => listeners.forEach((l) => { try { l(id); } catch { /* listener errors never stop the run */ } });

/** Starts driving if not already; returns immediately. maxSteps bounds a single session (each step is bounded too). */
export function driveRun(core: Core, p: string, id: string, o: { model?: ModelCall; maxSteps?: number; pauseMs?: number } = {}) {
  const key = `${p}:${id}`;
  if (driving.has(key)) return false;
  driving.add(key);
  safe(() => hooks.busy?.(driving.size));
  void (async () => {
    let last = { status: "active", goal: "" };
    try {
      for (let i = 0; i < (o.maxSteps ?? 400); i++) {
        const r = o.model ? await stepRun(core, p, id, o.model) : await stepRun(core, p, id);
        last = { status: r.status, goal: r.goal };
        notify(id);
        if (r.status !== "active") break;
        if (o.pauseMs !== 0) { const ms = o.pauseMs ?? 50; await (hooks.pause ? hooks.pause(ms) : new Promise((res) => setTimeout(res, ms))); }
      }
    } catch { /* stepRun records its own failures on the run; a concurrent step simply ends this driver */ }
    finally {
      driving.delete(key); notify(id);
      safe(() => hooks.settled?.(p, id, last.status, last.goal));
      safe(() => (driving.size ? hooks.busy?.(driving.size) : hooks.idle?.()));
    }
  })();
  return true;
}
/** Resolves when the driver for this run stops (tests and UI helpers). */
export async function waitForDriver(p: string, id: string, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (driving.has(`${p}:${id}`) && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 10));
}
