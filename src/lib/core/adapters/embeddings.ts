// OpenAI-style /embeddings (OpenAI and Azure OpenAI).
import { ProviderError } from "../../providers";
import type { RunRequest, RunResult } from "./types";

export const EMBED_BATCH = 64;

export function embeddingInputs(r: RunRequest): string[] {
  const inputs = (r.params?.["inputs"] as string[] | undefined) ?? (r.prompt ? [r.prompt] : []);
  if (!inputs.length) throw new ProviderError("parameters", "No hay texto para indexar.");
  if (inputs.length > EMBED_BATCH) throw new ProviderError("parameters", `Máximo ${EMBED_BATCH} fragmentos por solicitud.`);
  return inputs;
}

export function embeddingBody(r: RunRequest, withModel: boolean) {
  const b: Record<string, unknown> = { input: embeddingInputs(r) };
  if (withModel) b["model"] = r.model;
  return b;
}

export function parseEmbeddings(d: any, expected: number): RunResult {
  const items = Array.isArray(d?.data) ? [...d.data].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0)) : [];
  const vectors = items.map((x: any) => x?.embedding).filter((v: unknown) => Array.isArray(v) && v.length > 0) as number[][];
  if (vectors.length !== expected) throw new ProviderError("parameters", "Respuesta inválida: el número de vectores no coincide.", 200);
  return { kind: "vectors", vectors };
}
