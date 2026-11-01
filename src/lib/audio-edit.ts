export type PcmAudio = { sampleRate: number; channels: Float32Array[] };
export type AudioEdit = { start: number; end: number; gain: number; fadeIn: number; fadeOut: number; normalize: boolean };
export function editPcm(source: PcmAudio, edit: AudioEdit): PcmAudio {
  const first = source.channels[0]; if (!first || !source.sampleRate) throw new Error("Audio vacío.");
  const duration = first.length / source.sampleRate;
  if (![edit.start, edit.end, edit.gain, edit.fadeIn, edit.fadeOut].every(Number.isFinite) || edit.start < 0 || edit.end <= edit.start || edit.end > duration + 0.001 || edit.gain < 0 || edit.gain > 4 || edit.fadeIn < 0 || edit.fadeOut < 0) throw new Error("Intervalo o volumen no válido.");
  const start = Math.floor(edit.start * source.sampleRate), end = Math.min(first.length, Math.round(edit.end * source.sampleRate));
  const channels = source.channels.map((ch) => ch.slice(start, end));
  const length = end - start;
  let peak = 0;
  for (const channel of channels) for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i] ?? 0));
  const gain = edit.gain * (edit.normalize && peak > 0 ? 0.95 / peak : 1);
  for (const channel of channels) for (let i = 0; i < length; i++) {
    const envelope = Math.min(1, edit.fadeIn ? i / (edit.fadeIn * source.sampleRate) : 1, edit.fadeOut ? (length - 1 - i) / (edit.fadeOut * source.sampleRate) : 1);
    channel[i] = Math.max(-1, Math.min(1, (channel[i] ?? 0) * gain * Math.max(0, envelope)));
  }
  return { sampleRate: source.sampleRate, channels };
}
export function mixPcm(tracks: { audio: PcmAudio; offset: number; gain: number }[]): PcmAudio {
  if (!tracks.length || tracks.length > 4) throw new Error("Elige entre una y cuatro pistas.");
  const sampleRate = tracks[0]?.audio.sampleRate; if (!sampleRate) throw new Error("Audio vacío");
  if (tracks.some((t) => t.audio.sampleRate !== sampleRate || !Number.isFinite(t.offset) || t.offset < 0 || !Number.isFinite(t.gain) || t.gain < 0 || t.gain > 4 || !t.audio.channels[0])) throw new Error("Frecuencia, tiempo o volumen no válido.");
  const length = Math.max(...tracks.map((t) => Math.round(t.offset * sampleRate) + (t.audio.channels[0]?.length ?? 0)));
  if (length > sampleRate * 600) throw new Error("Máximo diez minutos para mezcla local.");
  const channels = [new Float32Array(length), new Float32Array(length)];
  for (const t of tracks) for (let c = 0; c < 2; c++) {
    const source = t.audio.channels[c] ?? t.audio.channels[0], dest = channels[c]; if (!source || !dest) continue;
    const off = Math.round(t.offset * sampleRate);
    for (let i = 0; i < source.length; i++) dest[off + i] = (dest[off + i] ?? 0) + (source[i] ?? 0) * t.gain;
  }
  let peak = 1;
  for (const ch of channels) for (const value of ch) peak = Math.max(peak, Math.abs(value));
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] ?? 0) / peak;
  return { sampleRate, channels };
}
export function encodeWav(audio: PcmAudio): Uint8Array {
  const samples = audio.channels[0]?.length ?? 0, count = audio.channels.length;
  if (!samples || count < 1 || count > 2) throw new Error("Exportación WAV requiere audio mono o estéreo.");
  const bytes = new Uint8Array(44 + samples * count * 2), view = new DataView(bytes.buffer);
  const str = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  str(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); str(8, "WAVE"); str(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true); view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * count * 2, true); view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); str(36, "data"); view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < samples; i++) for (let c = 0; c < count; c++) { const value = Math.max(-1, Math.min(1, audio.channels[c]?.[i] ?? 0)); view.setInt16(44 + (i * count + c) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); }
  return bytes;
}
export async function decodeAudio(bytes: Uint8Array): Promise<PcmAudio> {
  const context = new AudioContext({ sampleRate: 44100 });
  try { const buffer = await context.decodeAudioData(bytes.slice().buffer as ArrayBuffer); if (buffer.duration > 600) throw new Error("Máximo diez minutos para edición local."); return { sampleRate: buffer.sampleRate, channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, n) => buffer.getChannelData(n).slice()) }; }
  finally { await context.close(); }
}