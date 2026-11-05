// Automatic Azure setup: one resource URL + one key → every deployment detected, typed and tested.
// Pure helpers live here (unit-tested); the UI only orchestrates them.
import { azureDeploymentKind, cosmosBase, looksLikeCosmosEndpoint, parseAzureUrl, type AzureDeploymentKind } from "./azure-url";

export type AutoKind = AzureDeploymentKind | "video";
export type AutoRow = { deployment: string; model?: string; endpoint: string; apiVersion?: string; kind: AutoKind };

/** Legacy API version used only when the v1 route is rejected for a deployment. */
export const LEGACY_FALLBACK_VERSION = "2025-03-01-preview";

/** Type of a deployment from its name, the base model it runs (when Azure tells us) and the pasted operation. */
export function inferAutoKind(deployment: string, model?: string, op?: Parameters<typeof azureDeploymentKind>[1]): AutoKind {
  if (op === "videos" || /sora/i.test(deployment) || /sora/i.test(model ?? "")) return "video";
  const byName = azureDeploymentKind(deployment, op);
  if (byName !== "chat" || !model) return byName;
  return azureDeploymentKind(model);
}

/** The base resource as an /openai/v1 URL (deployment goes in the body; no API version needed). */
export function baseOf(raw: string): { origin: string; v1: string } | null {
  const a = parseAzureUrl(raw);
  if (!a) return null;
  const origin = a.endpoint.replace(/\/openai\/v1$/, "");
  return { origin, v1: `${origin}/openai/v1` };
}

/**
 * Lines can be plain deployment names or any URL copied from the portal. A full URL keeps its own
 * resource/version; names use the base resource. Duplicates are removed.
 */
export function parseDeploymentLines(text: string, baseUrl: string): AutoRow[] {
  const base = baseOf(baseUrl);
  const out = new Map<string, AutoRow>();
  for (const line of text.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean)) {
    if (/^(https|wss):\/\//i.test(line)) {
      const a = parseAzureUrl(line);
      if (!a?.deployment) continue;
      const endpoint = a.v1 ? a.endpoint : a.apiVersion ? a.endpoint : `${a.endpoint}/openai/v1`;
      if (!out.has(a.deployment.toLowerCase())) out.set(a.deployment.toLowerCase(), { deployment: a.deployment, endpoint, ...(a.apiVersion && !a.v1 ? { apiVersion: a.apiVersion } : {}), kind: inferAutoKind(a.deployment, undefined, a.op) });
    } else if (base && /^[A-Za-z0-9._-]{1,64}$/.test(line) && !out.has(line.toLowerCase())) {
      out.set(line.toLowerCase(), { deployment: line, endpoint: base.v1, kind: inferAutoKind(line) });
    }
  }
  return [...out.values()];
}

/** Rows from Azure's deployment list ({ data: [{ id, model, status }] }). Failed/deleting deployments are skipped. */
export function rowsFromDeploymentList(json: unknown, baseUrl: string): AutoRow[] {
  const base = baseOf(baseUrl);
  const data = (json as { data?: unknown; value?: unknown } | null)?.data ?? (json as { value?: unknown } | null)?.value;
  if (!base || !Array.isArray(data)) return [];
  const rows: AutoRow[] = [];
  for (const d of data as { id?: unknown; name?: unknown; model?: unknown; status?: unknown; properties?: { model?: { name?: unknown } } }[]) {
    const id = typeof d.id === "string" ? d.id : typeof d.name === "string" ? d.name : "";
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) continue;
    if (typeof d.status === "string" && !["succeeded", "running"].includes(d.status.toLowerCase())) continue;
    const model = typeof d.model === "string" ? d.model : typeof d.properties?.model?.name === "string" ? d.properties.model.name : undefined;
    rows.push({ deployment: id, ...(model ? { model } : {}), endpoint: base.v1, kind: inferAutoKind(id, model) });
  }
  return rows;
}

/** Asks Azure for the resource's deployments with the user's key. Returns [] when the resource does not expose the list. */
export async function discoverAzureDeployments(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<AutoRow[]> {
  const base = baseOf(baseUrl);
  if (!base || !apiKey.trim()) return [];
  for (const version of ["2022-12-01", "2023-05-15"]) {
    try {
      const res = await fetch(`${base.origin}/openai/deployments?api-version=${version}`, { headers: { "api-key": apiKey.trim() }, signal: signal ?? null });
      if (res.status === 401 || res.status === 403) throw new Error("La API Key no es válida para este recurso.");
      if (!res.ok) continue;
      const rows = rowsFromDeploymentList(await res.json().catch(() => null), baseUrl);
      if (rows.length) return rows;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("La API Key")) throw e;
    }
  }
  return [];
}

export const AUTO_KIND_LABEL: Record<AutoKind, string> = {
  chat: "Chat", realtime: "Voz en tiempo real", tts: "Texto a voz", transcribe: "Transcripción",
  "audio-chat": "Audio", embedding: "Búsqueda en documentos", image: "Imágenes", video: "Video (Sora)",
  cosmos: "Video e imágenes (NVIDIA Cosmos)",
};

/** A pasted managed-compute endpoint (Foundry "Target URI" of an NVIDIA Cosmos deployment) → one Cosmos row. */
export function cosmosRowFromUrl(raw: string, names: string): AutoRow | null {
  if (!looksLikeCosmosEndpoint(raw)) return null;
  const base = cosmosBase(raw)!;
  const typed = names.split(/[\n,;]+/).map((l) => l.trim()).find((l) => /^[A-Za-z0-9._-]{1,64}$/.test(l));
  const host = new URL(base).hostname.split(".")[0] ?? "cosmos";
  const deployment = typed ?? (/cosmos/i.test(host) ? host : `cosmos-${host}`).slice(0, 64);
  return { deployment, endpoint: base, kind: "cosmos" };
}

/** Origin of any saved endpoint (Azure resource or Cosmos), for "same connection" matching. */
export function originOf(raw: string | null | undefined): string | null {
  try { return new URL((raw ?? "").trim()).origin; } catch { return null; }
}
