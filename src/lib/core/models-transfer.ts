// Model setup transfer ("Enviar por Bluetooth" from Modelos). Carries providers, endpoints, deployments,
// registered models, their capabilities and favorites, sealed with a password. API keys are NEVER included:
// the receiving phone re-enters each key and verifies it with a real response before use.
import type { Repo, ProviderKind } from "../db/repo";
import { scrubSecrets } from "../db/repo";
import { deriveBackupKey, argonParams, PBKDF2_MIN_ITERATIONS, type Kdf } from "./backup";

const te = new TextEncoder(), td = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

type ModelEntry = { remoteId: string; name: string; favorite: number; contextTokens: number | null; costInfo: string | null; privacy: string; caps: string[] };
type ProviderEntry = { name: string; kind: ProviderKind; endpoint: string | null; deployment: string | null; model: string; apiVersion: string | null; extraParams: string | null; enabled: number; models: ModelEntry[] };
export type ModelsPayload = { providers: ProviderEntry[] };
type ModelsFile = { format: "miai-models"; v: 1; kdf: Kdf; iv: string; data: string };

export async function collectModels(repo: Repo): Promise<ModelsPayload> {
  const providers = await repo.listProviders();
  const all = await repo.registry.listModels();
  return {
    providers: providers.map((p) => ({
      name: p.name, kind: p.kind, endpoint: p.endpoint, deployment: p.deployment, model: p.model, apiVersion: p.api_version,
      extraParams: p.extra_params == null ? null : String(scrubSecrets({ extra_params: p.extra_params })["extra_params"]),
      enabled: p.enabled,
      models: all.filter((m) => m.provider_id === p.id).map((m) => ({
        remoteId: m.remote_id, name: m.name, favorite: m.favorite, contextTokens: m.context_tokens ?? null, costInfo: m.cost_info ?? null, privacy: m.privacy,
        caps: m.capabilities.map((c) => c.id),
      })),
    })),
  };
}

export async function exportModels(opts: { repo: Repo; password: string; kdf?: "argon2id" | "pbkdf2"; deviceMemGB?: number | null }): Promise<string> {
  const payload = await collectModels(opts.repo);
  if (!payload.providers.length) throw new Error("No hay modelos configurados para enviar.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kdf: Kdf = opts.kdf === "pbkdf2"
    ? { alg: "pbkdf2-sha256", iterations: PBKDF2_MIN_ITERATIONS, salt: b64(salt) }
    : { alg: "argon2id", v: 19, ...argonParams(opts.deviceMemGB ?? null), salt: b64(salt) };
  const key = await deriveBackupKey(opts.password, kdf);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = { format: "miai-models", v: 1, kdf } as const;
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: te.encode(JSON.stringify(header)) as BufferSource }, key, te.encode(JSON.stringify(payload)) as BufferSource));
  return JSON.stringify({ ...header, iv: b64(iv), data: b64(ct) } satisfies ModelsFile);
}

async function openModels(text: string, password: string): Promise<ModelsPayload> {
  let f: ModelsFile;
  try { f = JSON.parse(text); } catch { throw new Error("Archivo de modelos ilegible"); }
  if (f?.format !== "miai-models" || f.v !== 1) throw new Error("No es un archivo de modelos de MI AI");
  const key = await deriveBackupKey(password, f.kdf);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(f.iv) as BufferSource, additionalData: te.encode(JSON.stringify({ format: f.format, v: f.v, kdf: f.kdf })) as BufferSource }, key, unb64(f.data) as BufferSource);
    const p = JSON.parse(td.decode(pt)) as ModelsPayload;
    if (!Array.isArray(p?.providers)) throw new Error();
    return p;
  } catch { throw new Error("Contraseña incorrecta o archivo alterado"); }
}

const same = (a: { kind: string; endpoint: string | null; deployment: string | null; model: string }, b: typeof a) =>
  a.kind === b.kind && (a.endpoint ?? "") === (b.endpoint ?? "") && (a.deployment ?? "") === (b.deployment ?? "") && a.model === b.model;

/** Adds the received setup next to the existing one (never overwrites). Providers already present are skipped. */
export async function importModels(opts: { repo: Repo; text: string; password: string }): Promise<{ added: number; skipped: number; models: number }> {
  const payload = await openModels(opts.text, opts.password); // nothing is written before this succeeds
  const { repo } = opts;
  const existing = await repo.listProviders();
  const known = new Set((await repo.registry.listCapabilities()).map((c) => c.id));
  let added = 0, skipped = 0, models = 0;
  for (const p of payload.providers) {
    if (typeof p?.name !== "string" || typeof p.kind !== "string" || typeof p.model !== "string") continue;
    if (existing.some((e) => same(e, p))) { skipped++; continue; }
    const id = await repo.saveProvider({
      name: p.name, kind: p.kind, model: p.model, enabled: p.enabled !== 0,
      ...(p.endpoint ? { endpoint: p.endpoint } : {}), ...(p.deployment ? { deployment: p.deployment } : {}),
      ...(p.apiVersion ? { apiVersion: p.apiVersion } : {}), ...(p.extraParams ? { extraParams: p.extraParams } : {}),
    });
    added++;
    for (const m of p.models ?? []) {
      if (typeof m?.remoteId !== "string" || !m.remoteId) continue;
      const mid = await repo.registry.upsertModel({ providerId: id, remoteId: m.remoteId, name: m.name || m.remoteId, source: "manual", contextTokens: m.contextTokens ?? null, costInfo: m.costInfo ?? null, ...(m.privacy === "local" || m.privacy === "external" ? { privacy: m.privacy } : {}) });
      const caps = (m.caps ?? []).filter((c) => known.has(c));
      if (caps.length) await repo.registry.setModelCapabilities(mid, caps);
      if (m.favorite) await repo.registry.setFavorite(mid, true);
      models++;
    }
  }
  return { added, skipped, models };
}

export const MODELS_EXT = ".miaimodels";
export const isModelsFileName = (n: string) => /\.miaimodels(\.zip)?$/i.test(n);
