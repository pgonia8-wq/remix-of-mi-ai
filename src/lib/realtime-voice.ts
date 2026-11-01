import type { Core } from "./core";
import { credentialsFor } from "./core/executor";
import { call } from "./core/adapters/http";
import { budgetGate, recordUsage } from "./core/costs";
import type { ModelWithCaps } from "./core/registry";
export function realtimeConfig(model: string, instructions: string, voice: string) {
  return { type: "realtime", model, instructions, output_modalities: ["audio"], audio: { input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "server_vad", interrupt_response: true } }, output: { voice } } };
}
/** The user's encrypted on-device key mints a short-lived client token; no app server or key persistence. */
export async function startRealtime(core: Core, projectId: string, model: ModelWithCaps, voice: string, events: { state(s: string): void; transcript(role: "user" | "assistant", text: string): void; error(): void }) {
  if (!model.capabilities.includes("speech.realtime") || model.provider_kind !== "openai") throw new Error("Esta sesión requiere un modelo OpenAI que declare voz en tiempo real.");
  await budgetGate(core.repo, projectId, model.remote_id, { seconds: 60 }); // before any credential or network access
  const { creds } = await credentialsFor(core.repo, model.provider_id);
  if (!creds.apiKey) throw new Error("Falta la clave del proveedor.");
  const context = await core.repo.buildContext(projectId, "");
  const session = realtimeConfig(model.remote_id, `Eres MI AI. Usa únicamente este proyecto autorizado: ${context}. No ejecutes herramientas ni comandos.`, voice);
  const token = await (await call("https://api.openai.com/v1/realtime/client_secrets", { method: "POST", headers: { authorization: `Bearer ${creds.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ session }) }, creds.apiKey, 20_000)).json();
  if (typeof token?.value !== "string") throw new Error("El proveedor no devolvió una sesión de voz válida.");
  const startedAt = Date.now();
  const pc = new RTCPeerConnection(), audio = new Audio(); audio.autoplay = true;
  let media: MediaStream | null = null, closed = false;
  const stop = () => { if (!closed) void recordUsage(core.repo, projectId, { providerId: model.provider_id, model: model.remote_id, operation: "speech.realtime", usage: { seconds: Math.round((Date.now() - startedAt) / 1000) } }).catch((e) => console.warn("No se pudo registrar el costo de la voz:", e instanceof Error ? e.message : e)); closed = true; media?.getTracks().forEach((t) => t.stop()); pc.close(); audio.pause(); audio.srcObject = null; events.state("idle"); };
  try {
    media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    for (const track of media.getTracks()) pc.addTrack(track, media);
    pc.ontrack = (event) => { audio.srcObject = event.streams[0] ?? null; audio.play().catch(() => events.error()); };
    const dc = pc.createDataChannel("oai-events");
    dc.onmessage = (message) => {
      let data; try { data = JSON.parse(message.data); } catch { return; }
      if (data.type === "input_audio_buffer.speech_started") events.state("listening");
      if (data.type === "response.created") events.state("speaking");
      if (data.type === "response.done") events.state("listening");
      if (data.type === "conversation.item.input_audio_transcription.completed" && data.transcript) events.transcript("user", data.transcript);
      if (["response.output_audio_transcript.done", "response.audio_transcript.done"].includes(data.type) && data.transcript) events.transcript("assistant", data.transcript);
      if (data.type === "error") events.error();
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "connected") events.state("listening"); if (["failed", "closed"].includes(pc.connectionState) && !closed) { events.error(); stop(); } };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const res = await call("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { authorization: `Bearer ${token.value}`, "content-type": "application/sdp" }, body: offer.sdp ?? "" }, token.value, 20_000);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    return { stop, interrupt: () => { if (dc.readyState === "open") { dc.send(JSON.stringify({ type: "response.cancel" })); dc.send(JSON.stringify({ type: "output_audio_buffer.clear" })); } }, mute: (muted: boolean) => media?.getAudioTracks().forEach((t) => { t.enabled = !muted; }) };
  } catch (e) { stop(); throw e; }
}