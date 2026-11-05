// Keeps autonomous runs alive with the screen off or the app in the background (Android foreground notice +
// bounded wake lock), and tells the person when a run needs them or finishes. Never executes tools itself.
import { setDriveHooks } from "@/lib/automation/drive";
import { MiaiDevice, onDevice } from "@/lib/device";

const SETTLE_TEXT: Record<string, string> = {
  waiting: "Necesita tu aprobación para continuar.",
  review_required: "Necesita tu revisión.",
  needs_human: "Necesita tu ayuda para continuar.",
  completed: "Terminó el trabajo.",
  failed: "Se detuvo por un error.",
  paused: "Quedó en pausa.",
};

/** Pause that is not throttled in hidden pages (timers are slowed to once per minute while the screen is off). */
export function backgroundPause(ms: number): Promise<void> {
  if (typeof document === "undefined" || !document.hidden) return new Promise((r) => setTimeout(r, ms));
  return new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });
}

const localNotify = async (title: string, body: string) => {
  if (!onDevice()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2_000_000_000), title: title.slice(0, 60), body: body.slice(0, 200) }] });
};
async function fireReaction(p: string, event: "file.added" | "run.completed" | "run.needs_person", d: { name: string; mime?: string; assetId?: string; runId?: string; capability?: string | null }) {
  try {
    const [{ getCore }, { react }] = await Promise.all([import("@/lib/core"), import("@/lib/automation/reactions")]);
    await react(await getCore(), p, event, d, { notify: localNotify });
  } catch { /* reactions are best-effort and never affect the work that triggered them */ }
}

let installed = false, asked = false, agentsActive = 0, answersActive = 0;
function refreshNotice() {
  if (!onDevice()) return;
  if (!agentsActive && !answersActive) { void MiaiDevice.stopWork().catch(() => undefined); return; }
  void (async () => {
    if (!asked) { asked = true; try { const { LocalNotifications } = await import("@capacitor/local-notifications"); await LocalNotifications.requestPermissions(); } catch { /* the work keeps going without the visible notice */ } }
    const title = agentsActive ? "Agentes de MI AI trabajando" : "MI AI está respondiendo…";
    const text = agentsActive ? (agentsActive === 1 ? "1 trabajo en curso · toca para ver el avance" : `${agentsActive} trabajos en curso · toca para ver el avance`) : "La respuesta se sigue escribiendo y guardando con la pantalla bloqueada.";
    await MiaiDevice.startWork({ title, text }).catch(() => undefined);
  })();
}
/** Keeps a chat answer alive with the screen locked (same foreground notice as agents). Call the returned function when done. */
export function beginAnswerWork(): () => void {
  answersActive++; refreshNotice();
  let done = false;
  return () => { if (done) return; done = true; answersActive = Math.max(0, answersActive - 1); refreshNotice(); };
}
export function installBackgroundWork() {
  if (installed) return; installed = true;
  void import("@/lib/core/asset-store").then(({ onAssetAdded }) => onAssetAdded((a) => void fireReaction(a.project_id, "file.added", { name: a.name ?? a.id, mime: a.mime, assetId: a.id, capability: a.capability_id })));
  setDriveHooks({
    pause: backgroundPause,
    busy(active) { agentsActive = active; refreshNotice(); },
    idle() { agentsActive = 0; refreshNotice(); },
    settled(p, id, status, goal) {
      if (status === "completed") void fireReaction(p, "run.completed", { name: goal, runId: id });
      else if (["waiting", "review_required", "needs_human"].includes(status)) void fireReaction(p, "run.needs_person", { name: goal, runId: id });
      const text = SETTLE_TEXT[status];
      if (!text || !onDevice() || typeof document === "undefined" || !document.hidden) return;
      void import("@capacitor/local-notifications").then(({ LocalNotifications }) => LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2_000_000_000), title: goal.slice(0, 60) || "Trabajo de agentes", body: text }] })).catch(() => undefined);
    },
  });
}
