import { afterEach, expect, it, vi } from "vitest";
import { startRealtime, realtimeConfig } from "@/lib/realtime-voice";
import type { Core } from "@/lib/core";
import type { ModelWithCaps } from "@/lib/core/registry";
vi.mock("@/lib/core/executor", () => ({ credentialsFor: async () => ({ creds: { apiKey: "unit-test-only" } }) }));
afterEach(() => { vi.unstubAllGlobals(); });
it("realtime uses bidirectional audio and interruption without granting any tools", () => {
  const session = realtimeConfig("voice-model", "authorized project", "marin");
  expect(session.output_modalities).toEqual(["audio"]);
  expect(session.audio.input.turn_detection.interrupt_response).toBe(true);
  expect(session).not.toHaveProperty("tools");
});
it("sends project context only when minting a token, sends only ephemeral token to SDP, and stops tracks", async () => {
  const requests: { url: string; auth: string | null; body: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, auth: new Headers(init.headers).get("authorization"), body: String(init.body) });
    return url.endsWith("client_secrets") ? new Response(JSON.stringify({ value: "ephemeral-unit-test" })) : new Response("answer-sdp");
  }));
  const track = { stop: vi.fn(), enabled: true };
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } });
  const close = vi.fn(), sent: string[] = [];
  vi.stubGlobal("RTCPeerConnection", class { addTrack() {} createDataChannel() { return { readyState: "open", send: (data: string) => sent.push(data) }; } async createOffer() { return { sdp: "offer-sdp" }; } async setLocalDescription() {} async setRemoteDescription() {} close = close; });
  vi.stubGlobal("Audio", class { autoplay = false; srcObject = null; pause() {} });
  const core = { repo: { buildContext: vi.fn(async () => "private project A") } } as unknown as Core;
  const model = { capabilities: ["speech.realtime"], provider_kind: "openai", provider_id: "provider", remote_id: "voice-model" } as ModelWithCaps;
  const active = await startRealtime(core, "project-a", model, "marin", { state() {}, transcript() {}, error() {} });
  expect(core.repo.buildContext).toHaveBeenCalledWith("project-a", "");
  expect(JSON.parse(requests[0].body).session.instructions).toContain("private project A");
  expect(requests[1].auth).toBe("Bearer ephemeral-unit-test");
  expect(requests[1].body).toBe("offer-sdp");
  active.mute(true); expect(track.enabled).toBe(false);
  active.interrupt(); expect(sent.map((s) => JSON.parse(s).type)).toEqual(["response.cancel", "output_audio_buffer.clear"]);
  active.stop(); expect(track.stop).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
});