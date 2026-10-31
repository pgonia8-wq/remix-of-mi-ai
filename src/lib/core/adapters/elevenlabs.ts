import { ProviderError } from "../../providers";
import { call, requireKey } from "./http";
import { audioInput, parseTranscript } from "./audio";
import { sync, trimSlash, type AdapterCredentials, type ProviderAdapter } from "./types";

export const ELEVENLABS_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // premade "Rachel" voice
const base = (c: AdapterCredentials) => trimSlash(c.endpoint?.trim() || "https://api.elevenlabs.io/v1");

export const elevenlabsAdapter: ProviderAdapter = {
  id: "elevenlabs",
  label: "ElevenLabs",
  operations: { "audio.tts": sync(), "audio.transcribe": sync(), "audio.voice_clone": sync(), "music.generate": sync(), "audio.sfx": sync() },
  supports(cap) { return cap in this.operations; },
  async run(c, r) {
    const key = requireKey(c.apiKey);
    if (r.capability === "music.generate" || r.capability === "audio.sfx") {
      const text = r.prompt?.trim();
      if (!text) throw new ProviderError("parameters", "Describe la música o el sonido.");
      const seconds = Number(r.params?.["seconds"] ?? 30);
      const music = r.capability === "music.generate";
      if (!Number.isFinite(seconds) || seconds < (music ? 3 : 0.5) || seconds > (music ? 600 : 30)) throw new ProviderError("parameters", "Duración fuera del rango permitido por el proveedor.");
      const body = music ? { prompt: text, music_length_ms: Math.round(seconds * 1000), model_id: r.model, force_instrumental: r.params?.["instrumental"] === true }
        : { text, duration_seconds: seconds, prompt_influence: 0.3 };
      const res = await call(`${base(c)}/${music ? "music" : "sound-generation"}?output_format=mp3_44100_128`, { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify(body), signal: r.signal }, key, 600_000);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 100 || !res.headers.get("content-type")?.startsWith("audio/")) throw new ProviderError("parameters", "El proveedor no devolvió audio válido.");
      return { kind: "files", files: [{ bytes, mime: "audio/mpeg", name: music ? "musica.mp3" : "efecto.mp3" }] };
    }
    if (r.capability === "audio.tts") {
      const text = (r.prompt ?? "").trim();
      if (!text) throw new ProviderError("parameters", "Escribe el texto que quieres convertir en voz.");
      const voice = String(r.params?.["voice"] || ELEVENLABS_DEFAULT_VOICE);
      const res = await call(`${base(c)}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
        method: "POST", headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: r.model }), signal: r.signal ?? null,
      }, key);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 100) throw new ProviderError("parameters", "Respuesta inválida: audio vacío.", 200);
      return { kind: "files", files: [{ bytes, mime: "audio/mpeg", name: "voz.mp3" }] };
    }
    if (r.capability === "audio.transcribe") {
      const f = audioInput(r);
      const form = new FormData();
      form.append("model_id", /scribe/i.test(r.model) ? r.model : "scribe_v1");
      form.append("file", new Blob([f.bytes as BlobPart], { type: f.mime }), f.name);
      if (r.params?.["language"]) form.append("language_code", String(r.params["language"]));
      return parseTranscript(await call(`${base(c)}/speech-to-text`, { method: "POST", headers: { "xi-api-key": key }, body: form, signal: r.signal ?? null }, key), !!r.params?.["allowEmpty"]);
    }
    if (r.capability === "audio.voice_clone") {
      if (r.params?.["consent"] !== true) throw new ProviderError("parameters", "Clonar una voz requiere confirmar el consentimiento de la persona dueña de la voz.");
      const name = String(r.params?.["name"] ?? "").trim();
      if (!name) throw new ProviderError("parameters", "Ponle un nombre a la voz.");
      if (!r.files?.length) throw new ProviderError("parameters", "Agrega al menos una muestra de audio.");
      const form = new FormData();
      form.append("name", name);
      for (const file of r.files) { const f = audioInput({ ...r, files: [file] }); form.append("files", new Blob([f.bytes as BlobPart], { type: f.mime }), f.name); }
      const d = await (await call(`${base(c)}/voices/add`, { method: "POST", headers: { "xi-api-key": key }, body: form, signal: r.signal ?? null }, key)).json().catch(() => null);
      if (typeof d?.voice_id !== "string") throw new ProviderError("parameters", "Respuesta inválida: el proveedor no devolvió la voz creada.", 200);
      return { kind: "text", text: d.voice_id };
    }
    throw new ProviderError("parameters", `ElevenLabs no implementa «${r.capability}» en este adaptador.`);
  },
  async listVoices(c) {
    const key = requireKey(c.apiKey);
    const d = await (await call(`${base(c)}/voices`, { headers: { "xi-api-key": key } }, key, 20_000)).json();
    return (d?.voices ?? []).map((v: any) => ({ id: String(v.voice_id), name: String(v.name ?? v.voice_id) }));
  },
  async listModels(c) {
    const key = requireKey(c.apiKey);
    const res = await call(`${base(c)}/models`, { headers: { "xi-api-key": key } }, key, 20_000);
    const d = await res.json();
    return (Array.isArray(d) ? d : []).filter((m: any) => m.can_do_text_to_speech !== false).map((m: any) => String(m.model_id));
  },
};
