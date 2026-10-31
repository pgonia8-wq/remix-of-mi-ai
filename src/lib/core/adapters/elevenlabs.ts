import { ProviderError } from "../../providers";
import { call, requireKey } from "./http";
import { sync, trimSlash, type AdapterCredentials, type ProviderAdapter } from "./types";

export const ELEVENLABS_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // premade "Rachel" voice
const base = (c: AdapterCredentials) => trimSlash(c.endpoint?.trim() || "https://api.elevenlabs.io/v1");

export const elevenlabsAdapter: ProviderAdapter = {
  id: "elevenlabs",
  label: "ElevenLabs",
  operations: { "audio.tts": sync() },
  supports(cap) { return cap in this.operations; },
  async run(c, r) {
    const key = requireKey(c.apiKey);
    if (r.capability !== "audio.tts") throw new ProviderError("parameters", `ElevenLabs no implementa «${r.capability}» en este adaptador.`);
    const voice = String(r.params?.["voice"] || ELEVENLABS_DEFAULT_VOICE);
    const res = await call(`${base(c)}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: r.prompt ?? "", model_id: r.model }), signal: r.signal ?? null,
    }, key);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 100) throw new ProviderError("parameters", "Respuesta inválida: audio vacío.", 200);
    return { kind: "files", files: [{ bytes, mime: "audio/mpeg", name: "voz.mp3" }] };
  },
  async listModels(c) {
    const key = requireKey(c.apiKey);
    const res = await call(`${base(c)}/models`, { headers: { "xi-api-key": key } }, key, 20_000);
    const d = await res.json();
    return (Array.isArray(d) ? d : []).filter((m: any) => m.can_do_text_to_speech !== false).map((m: any) => String(m.model_id));
  },
};
