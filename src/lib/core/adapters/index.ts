// Adapter registry. Text kinds keep the existing on-device streaming adapter (behaviour unchanged).
import { call, requireKey } from "./http";
import { chatViaLegacy } from "./openai";
import { openaiAdapter } from "./openai";
import { azureAdapter } from "./azure";
import { elevenlabsAdapter } from "./elevenlabs";
import { tavilyAdapter } from "./tavily";
import { meshyAdapter } from "./meshy";
import { sync, trimSlash, type ProviderAdapter } from "./types";
import { PROVIDER_KINDS } from "../../providers";

function textAdapter(kind: string): ProviderAdapter {
  const label = PROVIDER_KINDS.find((k) => k.kind === kind)?.label ?? kind;
  const openaiStyle = ["xai", "deepseek", "mistral", "openai_compatible"].includes(kind);
  return {
    id: `text:${kind}`, label,
    operations: { chat: sync() },
    supports(cap) { return cap === "chat"; },
    run: (c, r) => chatViaLegacy(c, r),
    ...(openaiStyle || kind === "gemini"
      ? {
          async listModels(c) {
            const ep = trimSlash(c.endpoint?.trim() || PROVIDER_KINDS.find((k) => k.kind === kind)?.endpoint || "");
            if (kind === "gemini") {
              const key = requireKey(c.apiKey);
              const d = await (await call(`${ep}/models`, { headers: { "x-goog-api-key": key } }, key, 20_000)).json();
              return (d?.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m: any) => String(m.name).replace(/^models\//, ""));
            }
            const d = await (await call(`${ep}/models`, { headers: c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {} }, c.apiKey, 20_000)).json();
            return (d?.data ?? []).map((m: any) => String(m.id)).filter(Boolean);
          },
        }
      : {}),
  };
}

export function getAdapter(adapterId: string): ProviderAdapter {
  if (adapterId === "openai") return openaiAdapter;
  if (adapterId === "azure_openai") return azureAdapter;
  if (adapterId === "elevenlabs") return elevenlabsAdapter;
  if (adapterId === "tavily") return tavilyAdapter;
  if (adapterId === "meshy") return meshyAdapter;
  return textAdapter(adapterId.replace(/^text:/, ""));
}

export type { ProviderAdapter } from "./types";
