import { registerPlugin } from "@capacitor/core";
import { isNative } from "./app-db";
import type { Core } from "./core";
export type Caption = { start: number; end: number; text: string };
export type VideoClip = { assetId: string; name: string; start: number; end: number; duration: number };
export const MiaiMedia = registerPlugin<{ editVideo(o: { clips: { path: string; startMs: number; endMs: number }[]; captions: Caption[]; rotation: number; ratio: string; mute: boolean; audioPath?: string }): Promise<{ path: string; size: number }>; cancel(): Promise<void> }>("MiaiMedia");
export function validateTimeline(clips: VideoClip[], captions: Caption[]) {
  if (!clips.length || clips.length > 8) throw new Error("Elige de uno a ocho clips.");
  for (const c of clips) if (![c.start, c.end, c.duration].every(Number.isFinite) || c.start < 0 || c.end <= c.start || c.end > c.duration + 0.01) throw new Error("Recorte fuera de la duración del clip.");
  const duration = clips.reduce((sum, c) => sum + c.end - c.start, 0);
  for (const c of captions) if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || c.end > duration + 0.01 || !c.text.trim()) throw new Error("Subtítulo fuera de la línea de tiempo.");
  return duration;
}
const timecode = (s: number) => { const ms = Math.round(s * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
export function captionsSrt(captions: Caption[]) { return captions.map((c, i) => `${i + 1}\n${timecode(c.start)} --> ${timecode(c.end)}\n${c.text}\n`).join("\n"); }
export type AudioTrack = { assetId: string; name: string; offset: number; gain: number };
/** Multitrack: background tracks are mixed locally (deterministic PCM) and trimmed to the video duration. */
export function validateAudioTracks(tracks: AudioTrack[], videoDuration: number) {
  if (tracks.length > 4) throw new Error("Máximo cuatro pistas de audio de fondo.");
  for (const t of tracks) if (!Number.isFinite(t.offset) || t.offset < 0 || t.offset >= videoDuration || !Number.isFinite(t.gain) || t.gain < 0 || t.gain > 2) throw new Error(`Pista «${t.name}» fuera de la línea de tiempo o con volumen no válido.`);
}
export async function mixBackground(core: Core, projectId: string, tracks: AudioTrack[], videoDuration: number) {
  if (!tracks.length) return undefined;
  const { decodeAudio, mixPcm, editPcm, encodeWav } = await import("./audio-edit");
  const decoded = [];
  for (const t of tracks) decoded.push({ audio: await decodeAudio(await core.assets.read(projectId, t.assetId)), offset: t.offset, gain: t.gain });
  const mixed = mixPcm(decoded);
  const first = mixed.channels[0]; if (!first) throw new Error("Mezcla vacía");
  const trimmed = editPcm(mixed, { start: 0, end: Math.min(videoDuration, first.length / mixed.sampleRate), gain: 1, fadeIn: 0, fadeOut: Math.min(1, videoDuration / 4), normalize: false });
  return encodeWav(trimmed);
}
export async function exportVideo(core: Core, projectId: string, clips: VideoClip[], captions: Caption[], settings: { rotation: number; ratio: string; mute: boolean }, tracks: AudioTrack[] = []) {
  const total = validateTimeline(clips, captions);
  validateAudioTracks(tracks, total);
  if (!isNative()) throw new Error("La exportación de video local necesita la APK Android; no se simula en la vista previa.");
  // Clips are decrypted and staged into the private cache in pieces; nothing travels as one huge base64 string.
  const { stageToCache, readCacheFile, removeCache } = await import("./device");
  const inputs: { path: string; startMs: number; endMs: number }[] = [];
  let audioPath: string | undefined;
  const cleanup = async () => { for (const i of inputs) await removeCache(i.path); if (audioPath) await removeCache(audioPath); };
  try {
    for (const clip of clips) inputs.push({ path: await stageToCache(core.assets.stream(projectId, clip.assetId), "clip.mp4"), startMs: Math.round(clip.start * 1000), endMs: Math.round(clip.end * 1000) });
    const wav = await mixBackground(core, projectId, tracks, total);
    if (wav) audioPath = await stageToCache(wav, "fondo.wav");
  } catch (e) { await cleanup(); throw e; }
  const job = await core.jobs.create(projectId, { capability: "video.local.edit", params: { clips, captions, tracks, ...settings } });
  await core.jobs.markSent(projectId, job.id);
  try {
    const result = await MiaiMedia.editVideo({ clips: inputs, captions, ...settings, ...(audioPath ? { audioPath } : {}) });
    await core.jobs.transition(projectId, job.id, "processing", { phase: "accepted" });
    let asset;
    try { asset = await core.assets.put(projectId, readCacheFile(result.path), { kind: "video", mime: "video/mp4", name: "Video editado.mp4", parentId: clips[0]?.assetId ?? null, capability: "video.local.edit", jobId: job.id, params: { clips, captions, ...settings } }); }
    finally { await removeCache(result.path); }
    await core.jobs.finishAttempt(projectId, job.id, "completed"); await core.jobs.transition(projectId, job.id, "completed", { phase: "received", progress: 1 });
    return asset;
  } catch (e) { await cleanup(); await core.jobs.finishAttempt(projectId, job.id, "failed"); await core.jobs.transition(projectId, job.id, "failed", { error: "Exportación local no completada." }); throw e; }
}