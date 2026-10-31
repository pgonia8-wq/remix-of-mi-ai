// Microphone recording in the WebView (Android asks for RECORD_AUDIO at runtime). Audio stays in memory until saved encrypted.
export function pickRecorderMime(isSupported: (m: string) => boolean = (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(isSupported) ?? "";
}

export const MAX_RECORD_MS = 10 * 60 * 1000;

export async function startRecording(onStop: (blob: Blob, ms: number) => void, onError: (msg: string) => void) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este dispositivo no permite grabar audio aquí.");
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { throw new Error((e as Error).name === "NotAllowedError" ? "Permiso de micrófono denegado. Actívalo en Ajustes de Android > Apps > MI AI." : "No se pudo abrir el micrófono."); }
  const mime = pickRecorderMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  const t0 = Date.now();
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onerror = () => onError("Error de grabación.");
  rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); clearTimeout(limit); onStop(new Blob(chunks, { type: (rec.mimeType || mime || "audio/webm").split(";")[0] }), Date.now() - t0); };
  const limit = setTimeout(() => rec.state !== "inactive" && rec.stop(), MAX_RECORD_MS);
  rec.start(1000);
  return { stop: () => { if (rec.state !== "inactive") rec.stop(); } };
}

export const extForAudio = (mime: string) => ({ "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav" } as Record<string, string>)[mime.split(";")[0]!] ?? "webm";
