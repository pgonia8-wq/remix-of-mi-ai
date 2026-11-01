// @vitest-environment node
import { describe, it, expect } from "vitest";
import { editPcm, mixPcm, encodeWav } from "@/lib/audio-edit";
describe("Procesamiento PCM local", () => {
  const source = { sampleRate: 4, channels: [new Float32Array([0, 0.5, 1, -1, 0.5, 0, -0.5, 0])] };
  it("recorta el intervalo correcto sin modificar el original", () => { const result = editPcm(source, { start: 0.5, end: 1.5, gain: 1, fadeIn: 0, fadeOut: 0, normalize: false }); expect(Array.from(result.channels[0] ?? [])).toEqual([1, -1, 0.5, 0]); expect(source.channels[0]?.length).toBe(8); });
  it("mezcla pistas con desplazamiento y evita saturación", () => { const result = mixPcm([{ audio: { sampleRate: 4, channels: [new Float32Array([0.5, 0.5])] }, offset: 0, gain: 1 }, { audio: { sampleRate: 4, channels: [new Float32Array([0.5, 0.5])] }, offset: 0.25, gain: 1 }]); expect(Array.from(result.channels[0] ?? [])).toEqual([0.5, 1, 0.5]); });
  it("exporta WAV PCM válido con número exacto de muestras", () => { const out = encodeWav(source); expect(new TextDecoder().decode(out.subarray(0, 4))).toBe("RIFF"); expect(new DataView(out.buffer).getUint32(40, true)).toBe(16); expect(out.length).toBe(60); });
  it("rechaza intervalos invertidos", () => { expect(() => editPcm(source, { start: 1, end: 0, gain: 1, fadeIn: 0, fadeOut: 0, normalize: false })).toThrow(); });
});