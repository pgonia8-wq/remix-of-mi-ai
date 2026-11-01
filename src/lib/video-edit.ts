import { registerPlugin } from "@capacitor/core";
import { isNative } from "./app-db";
import type { Core } from "./core";
export type Caption = { start: number; end: number; text: string };
export type VideoClip = { assetId: string; name: string; start: number; end: number; duration: number };
export const MiaiMedia = registerPlugin<{ editVideo(o: { clips: { data: string; startMs: number; endMs: number }[]; captions: Caption[]; rotation: number; ratio: string; mute: boolean }): Promise<{ data: string }>; cancel(): Promise<void> }>("MiaiMedia");
export function validateTimeline(clips: VideoClip[], captions: Caption[]) {
  if (!clips.length || clips.length > 8) throw new Error("Elige de uno a ocho clips.");
  for (const c of clips) if (![c.start, c.end, c.duration].every(Number.isFinite) || c.start < 0 || c.end <= c.start || c.end > c.duration + 0.01) throw new Error("Recorte fuera de la duración del clip.");
  const duration = clips.reduce((sum, c) => sum + c.end - c.start, 0);
  for (const c of captions) if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || c.end > duration + 0.01 || !c.text.trim()) throw new Error("Subtítulo fuera de la línea de tiempo.");
  return duration;
}
const timecode = (s: number) => { const ms = Math.round(s * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
export function captionsSrt(captions: Caption[]) { return captions.map((c, i) => `${i + 1}\n${timecode(c.start)} --> ${timecode(c.end)}\n${c.text}\n`).join("\n"); }
export async function exportVideo(core: Core, projectId: string, clips: VideoClip[], captions: Caption[], settings: { rotation: number; ratio: string; mute: boolean }) {
  validateTimeline(clips, captions);
  if (!isNative()) throw new Error("La exportación de video local necesita la APK Android; no se simula en la vista previa.");
  const inputs = [];
  for (const clip of clips) {
    const bytes = await core.assets.read(projectId, clip.assetId);
    let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    inputs.push({ data: btoa(binary), startMs: Math.round(clip.start * 1000), endMs: Math.round(clip.end * 1000) });
  }
  const job = await core.jobs.create(projectId, { capability: "video.local.edit", params: { clips, captions, ...settings } });
  await core.jobs.markSent(projectId, job.id);
  try {
    const result = await MiaiMedia.editVideo({ clips: inputs, captions, ...settings });
    await core.jobs.transition(projectId, job.id, "processing", { phase: "accepted" });
    const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
    const asset = await core.assets.put(projectId, (async function* () { yield bytes; })(), { kind: "video", mime: "video/mp4", name: "Video editado.mp4", parentId: clips[0]?.assetId ?? null, capability: "video.local.edit", jobId: job.id, params: { clips, captions, ...settings } });
    await core.jobs.finishAttempt(projectId, job.id, "completed"); await core.jobs.transition(projectId, job.id, "completed", { phase: "received", progress: 1 });
    return asset;
  } catch (e) { await core.jobs.finishAttempt(projectId, job.id, "failed"); await core.jobs.transition(projectId, job.id, "failed", { error: "Exportación local no completada." }); throw e; }
}