import { redactText } from "./app-info";

// Local crash log: unexpected errors stay on the device, redacted, and are only shared if the person exports them.
type Entry = { at: number; message: string };
const MAX = 50;
let installed = false;

async function store(message: string) {
  try {
    const { getCore } = await import("./core");
    const core = await getCore();
    await core.repo.addCrash(redactText(message).slice(0, 4000), MAX);
  } catch { /* storage not ready: nothing to do */ }
}

export function installCrashLog() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => { void store(`${e.message} @ ${e.filename}:${e.lineno}\n${e.error?.stack ?? ""}`); });
  window.addEventListener("unhandledrejection", (e) => { const r = e.reason; void store(r instanceof Error ? `${r.name}: ${r.message}\n${r.stack ?? ""}` : String(r)); });
}

export async function readCrashLog(): Promise<Entry[]> {
  const { getCore } = await import("./core");
  return (await getCore()).repo.listCrashes();
}
