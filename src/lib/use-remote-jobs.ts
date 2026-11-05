import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getCore } from "@/lib/core";
import { pollRemoteJob } from "@/lib/core/remote-jobs";

export const JOB_DONE_EVENT = "miai:remote-job-done";
export type JobDoneDetail = { projectId: string; jobId: string; capability: string | null; assetIds: string[] };

const LABEL: Record<string, string> = { "video.generate": "Tu video", "video.edit": "Tu video", "music.generate": "Tu música", "audio.sfx": "Tu efecto de sonido", "model3d.generate": "Tu modelo 3D" };

/**
 * App-wide watcher: slow provider jobs (videos, music, 3D) are checked every 20 s on any
 * screen, so the finished file lands in Biblioteca even if the user left the creation screen.
 * Poll only — a billed generation is never re-sent.
 */
export function useRemoteJobWatcher(projectId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    let live = true, running = false;
    const tick = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const core = await getCore();
        const pending = (await core.jobs.list(projectId, "processing")).filter((j) => !!j.remote_id);
        for (const j of pending) {
          if (!live) return;
          try {
            const r = await pollRemoteJob(core, projectId, j.id);
            if (r.pending) continue;
            await qc.invalidateQueries();
            toast.success(`${LABEL[j.capability_id ?? ""] ?? "Tu archivo"} está listo. Lo encuentras en Biblioteca.`);
            window.dispatchEvent(new CustomEvent<JobDoneDetail>(JOB_DONE_EVENT, { detail: { projectId, jobId: j.id, capability: j.capability_id, assetIds: r.assets.map((a) => a.id) } }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : "";
            if (msg === "Consulta ya activa.") continue;
            const after = await core.jobs.get(projectId, j.id);
            if (after?.status === "failed") { await qc.invalidateQueries(); toast.error(`${LABEL[j.capability_id ?? ""] ?? "El trabajo"} falló: ${msg || "el proveedor lo rechazó"}`); }
          }
        }
      } catch { /* storage not ready yet; next tick retries */ } finally { running = false; }
    };
    void tick();
    const t = setInterval(() => { void tick(); }, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [projectId, qc]);
}
