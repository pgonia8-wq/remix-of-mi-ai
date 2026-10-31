import { describe, it, expect } from "vitest";
import { pickRecorderMime, extForAudio } from "@/lib/recorder";
import { testWav } from "@/lib/core/adapters/audio";

describe("grabación", () => {
  it("prefers webm/opus, falls back to mp4 (older Android WebViews)", () => {
    expect(pickRecorderMime(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime((m) => m === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecorderMime(() => false)).toBe("");
  });
  it("file extension follows recorded format", () => {
    expect(extForAudio("audio/webm;codecs=opus")).toBe("webm");
    expect(extForAudio("audio/mp4")).toBe("m4a");
  });
  it("test WAV for real transcription checks is a valid RIFF/WAVE file", () => {
    const w = testWav();
    expect(new TextDecoder().decode(w.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(w.slice(8, 12))).toBe("WAVE");
    expect(w.length).toBe(44 + 9600 * 2);
  });
});
