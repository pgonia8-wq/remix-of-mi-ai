import { describe, expect, it } from "vitest";
import { inferAutoKind, parseDeploymentLines, rowsFromDeploymentList } from "@/lib/azure-autosetup";

const BASE = "https://pgonia8-4510-resource.openai.azure.com";

describe("configuración automática de Azure", () => {
  it("detecta el uso de cada deployment por su nombre", () => {
    expect(inferAutoKind("gpt-4o-mini-tts")).toBe("tts");
    expect(inferAutoKind("gpt-image-1")).toBe("image");
    expect(inferAutoKind("sora-2")).toBe("video");
    expect(inferAutoKind("gpt-realtime-mini")).toBe("realtime");
    expect(inferAutoKind("whisper")).toBe("transcribe");
    expect(inferAutoKind("gpt-5-chat")).toBe("chat");
  });

  it("usa el modelo base cuando el nombre del deployment no lo dice", () => {
    expect(inferAutoKind("mi-voz", "gpt-4o-mini-tts")).toBe("tts");
    expect(inferAutoKind("clips", "sora")).toBe("video");
  });

  it("acepta nombres y URLs del portal mezclados, sin duplicados", () => {
    const rows = parseDeploymentLines(`gpt-5-chat\nhttps://pgonia8-4510-resource.openai.azure.com/openai/deployments/gpt-4o-mini-tts/audio/speech?api-version=2025-03-01-preview\nGPT-5-CHAT`, `${BASE}/openai/v1/responses`);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ deployment: "gpt-5-chat", endpoint: `${BASE}/openai/v1`, kind: "chat" });
    expect(rows[1]).toMatchObject({ deployment: "gpt-4o-mini-tts", endpoint: BASE, apiVersion: "2025-03-01-preview", kind: "tts" });
  });

  it("lee la lista de deployments de Azure y omite los que fallaron", () => {
    const rows = rowsFromDeploymentList({ data: [{ id: "chat", model: "gpt-4o", status: "succeeded" }, { id: "img", model: "gpt-image-1", status: "succeeded" }, { id: "roto", model: "gpt-4o", status: "failed" }] }, BASE);
    expect(rows.map((r) => [r.deployment, r.kind])).toEqual([["chat", "chat"], ["img", "image"]]);
  });
});
