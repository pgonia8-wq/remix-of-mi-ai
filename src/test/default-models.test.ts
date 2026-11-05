import { describe, expect, it } from "vitest";
import { route } from "@/lib/core/router";
import { envNote } from "@/lib/automation/orchestrator";
import type { ModelWithCaps } from "@/lib/core/registry";

const model = (kind: string, caps: string[], defaults: string[] = []): ModelWithCaps => ({ id: kind, provider_id: kind, remote_id: "d", name: kind, source: "manual", status: "active", favorite: 0, cost_info: null, privacy: "external", context_tokens: null, updated_at: 1, provider_kind: kind, provider_name: kind, provider_enabled: 1, adapter_id: kind === "azure_openai" ? "azure_openai" : `text:${kind}`, capabilities: caps, defaults, tests: caps.map((c) => ({ model_id: kind, capability_id: c, status: "ok" as const, checked_at: 1, http_status: 200, message: null })) });

describe("Modelo elegido por la persona", () => {
  it("sin predeterminado, Automático sigue prefiriendo Azure verificado", () => {
    const d = route([model("deepseek", ["chat"]), model("azure_openai", ["chat"])], { capability: "chat", mode: "auto" });
    expect(d.ok && d.model.id).toBe("azure_openai");
  });
  it("el predeterminado de una función gana en modo automático", () => {
    const d = route([model("deepseek", ["chat"], ["chat"]), model("azure_openai", ["chat"])], { capability: "chat", mode: "auto" });
    expect(d.ok && d.model.id).toBe("deepseek");
  });
  it("el predeterminado de «Chat» también decide el modelo de los agentes con herramientas", () => {
    const d = route([model("deepseek", ["chat", "chat.tools"]), model("azure_openai", ["chat", "chat.tools"], ["chat"])], { capability: "chat.tools", mode: "auto" });
    expect(d.ok && d.model.id).toBe("azure_openai");
  });
  it("una elección manual para los agentes se respeta aunque haya otro predeterminado", () => {
    const d = route([model("deepseek", ["chat"], ["chat"]), model("azure_openai", ["chat"])], { capability: "chat", mode: "manual", manualModelId: "azure_openai" });
    expect(d.ok && d.model.id).toBe("azure_openai");
  });
  it("el servidor/VM elegido se comunica a los agentes con su id para ssh.exec", () => {
    expect(envNote({ nodeId: null, folderId: null, sshId: "11111111-1111-1111-1111-111111111111", sshName: "Mi VM" })).toMatch(/ssh\.exec.*11111111-1111-1111-1111-111111111111/);
  });
});
