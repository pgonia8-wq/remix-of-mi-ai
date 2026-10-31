import type { SqlDb } from "../db/sql";
import { INITIAL_CAPABILITIES, validateCapability, type CapabilitySpec } from "./capabilities";

export type RegistryProvider = { id: string; kind: string; name: string; adapter: string; enabled: number; legacy_provider_id: string | null; created_at: number };
export type RegistryModel = {
  id: string; provider_id: string; remote_id: string; name: string; status: "active" | "retired"; source: "manual" | "import" | "legacy";
  favorite: number; cost_info: string | null; privacy: "external" | "local"; context_tokens: number | null; updated_at: number;
};
export type ModelWithCaps = RegistryModel & { capabilities: string[]; provider_kind: string; provider_name: string; provider_enabled: number; tests: CapabilityTest[] };
export type CapabilityTest = { model_id: string; capability_id: string; status: "ok" | "error"; http_status: number | null; message: string | null; checked_at: number };

const uid = () => crypto.randomUUID();
const now = () => Date.now();

/** Which adapter family handles a provider kind. Text kinds reuse the existing on-device adapter. */
export function adapterFor(kind: string): string {
  if (kind === "elevenlabs") return "elevenlabs";
  if (kind === "tavily") return "tavily";
  if (kind === "azure_openai" || kind === "azure") return "azure_openai";
  if (kind === "openai") return "openai";
  return `text:${kind}`;
}

export class Registry {
  constructor(private db: SqlDb) {}

  async seedCapabilities() {
    for (const c of INITIAL_CAPABILITIES) {
      await this.db.run(`INSERT INTO capabilities (id, spec, builtin, updated_at) VALUES (?,?,1,?) ON CONFLICT(id) DO UPDATE SET spec=excluded.spec, updated_at=excluded.updated_at WHERE capabilities.builtin=1`, [c.id, JSON.stringify(c), now()]);
    }
  }
  async registerCapability(c: CapabilitySpec) {
    const errs = validateCapability(c);
    if (errs.length) throw new Error(`Capacidad inválida: ${errs.join(", ")}`);
    await this.db.run(`INSERT OR REPLACE INTO capabilities (id, spec, builtin, updated_at) VALUES (?,?,0,?)`, [c.id, JSON.stringify(c), now()]);
  }
  async listCapabilities(): Promise<CapabilitySpec[]> {
    const rows = await this.db.all<{ spec: string }>(`SELECT spec FROM capabilities ORDER BY id`);
    return rows.map((r) => JSON.parse(r.spec) as CapabilitySpec);
  }
  async getCapability(id: string): Promise<CapabilitySpec | null> {
    const [r] = await this.db.all<{ spec: string }>(`SELECT spec FROM capabilities WHERE id=?`, [id]);
    return r ? (JSON.parse(r.spec) as CapabilitySpec) : null;
  }

  /** Mirrors existing (v2) providers into the registry without touching or copying credentials. Idempotent. */
  async syncLegacyProviders() {
    const legacy = await this.db.all<{ id: string; name: string; kind: string; endpoint: string | null; deployment: string | null; model: string; api_version: string | null; enabled: number; created_at: number }>(
      `SELECT id, name, kind, endpoint, deployment, model, api_version, enabled, created_at FROM providers`,
    );
    for (const p of legacy) {
      await this.db.run(
        `INSERT INTO providers_registry (id, kind, name, adapter, enabled, legacy_provider_id, created_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, adapter=excluded.adapter, enabled=excluded.enabled`,
        [p.id, p.kind, p.name, adapterFor(p.kind), p.enabled, p.id, p.created_at],
      );
      await this.db.run(
        `INSERT INTO endpoints (id, provider_id, url, api_version, deployment) VALUES (?,?,?,?,?)
         ON CONFLICT(provider_id) DO UPDATE SET url=excluded.url, api_version=excluded.api_version, deployment=excluded.deployment`,
        [p.id, p.id, p.endpoint, p.api_version, p.deployment],
      );
      await this.db.run(`INSERT OR IGNORE INTO auth_refs (id, provider_id, legacy_provider_id) VALUES (?,?,?)`, [p.id, p.id, p.id]);
      const remote = (p.kind === "azure_openai" || p.kind === "azure" ? p.deployment : p.model)?.trim();
      if (remote && p.kind !== "elevenlabs" && p.kind !== "tavily") {
        const mid = await this.upsertModel({ providerId: p.id, remoteId: remote, name: remote, source: "legacy" });
        await this.db.run(`INSERT OR IGNORE INTO model_capabilities (model_id, capability_id) VALUES (?, 'chat')`, [mid]);
      }
    }
    // Registry rows whose legacy provider was deleted are removed with their models.
    const orphans = await this.db.all<{ id: string }>(`SELECT id FROM providers_registry WHERE legacy_provider_id IS NOT NULL AND legacy_provider_id NOT IN (SELECT id FROM providers)`);
    for (const o of orphans) await this.deleteProvider(o.id);
  }

  async deleteProvider(id: string) {
    const models = await this.db.all<{ id: string }>(`SELECT id FROM models WHERE provider_id=?`, [id]);
    for (const m of models) {
      await this.db.run(`DELETE FROM model_capabilities WHERE model_id=?`, [m.id]);
      await this.db.run(`DELETE FROM capability_tests WHERE model_id=?`, [m.id]);
      await this.db.run(`DELETE FROM model_versions WHERE model_id=?`, [m.id]);
    }
    for (const t of ["models"]) await this.db.run(`DELETE FROM ${t} WHERE provider_id=?`, [id]);
    for (const t of ["endpoints", "auth_refs"]) await this.db.run(`DELETE FROM ${t} WHERE provider_id=?`, [id]);
    await this.db.run(`DELETE FROM providers_registry WHERE id=?`, [id]);
  }

  listProviders() {
    return this.db.all<RegistryProvider>(`SELECT * FROM providers_registry ORDER BY created_at ASC`);
  }

  async upsertModel(m: { providerId: string; remoteId: string; name?: string; source: RegistryModel["source"]; contextTokens?: number | null; costInfo?: string | null; privacy?: RegistryModel["privacy"] }): Promise<string> {
    const [existing] = await this.db.all<{ id: string }>(`SELECT id FROM models WHERE provider_id=? AND remote_id=?`, [m.providerId, m.remoteId]);
    if (existing) {
      await this.db.run(`UPDATE models SET name=?, status='active', updated_at=? WHERE id=?`, [m.name ?? m.remoteId, now(), existing.id]);
      return existing.id;
    }
    const id = uid();
    await this.db.run(
      `INSERT INTO models (id, provider_id, remote_id, name, status, source, favorite, cost_info, privacy, context_tokens, updated_at) VALUES (?,?,?,?, 'active', ?, 0, ?, ?, ?, ?)`,
      [id, m.providerId, m.remoteId, m.name ?? m.remoteId, m.source, m.costInfo ?? null, m.privacy ?? "external", m.contextTokens ?? null, now()],
    );
    return id;
  }
  async setModelCapabilities(modelId: string, caps: string[]) {
    const known = new Set((await this.listCapabilities()).map((c) => c.id));
    for (const c of caps) if (!known.has(c)) throw new Error(`Capacidad desconocida: ${c}`);
    await this.db.run(`DELETE FROM model_capabilities WHERE model_id=?`, [modelId]);
    for (const c of caps) await this.db.run(`INSERT INTO model_capabilities (model_id, capability_id) VALUES (?,?)`, [modelId, c]);
  }
  async addModelVersion(modelId: string, version: string, notes?: string) {
    await this.db.run(`INSERT OR IGNORE INTO model_versions (id, model_id, version, notes, created_at) VALUES (?,?,?,?,?)`, [uid(), modelId, version, notes ?? null, now()]);
  }
  async setFavorite(modelId: string, fav: boolean) {
    await this.db.run(`UPDATE models SET favorite=? WHERE id=?`, [fav ? 1 : 0, modelId]);
  }
  async deleteModel(modelId: string) {
    for (const t of ["model_capabilities", "capability_tests", "model_versions"]) await this.db.run(`DELETE FROM ${t} WHERE model_id=?`, [modelId]);
    await this.db.run(`DELETE FROM models WHERE id=?`, [modelId]);
  }
  /** Catalog import: ids present upstream become active; previously imported ids that vanished are marked retired. */
  async applyImport(providerId: string, remoteIds: string[]) {
    const seen = new Set(remoteIds);
    for (const r of remoteIds) await this.upsertModel({ providerId, remoteId: r, source: "import" });
    const imported = await this.db.all<{ id: string; remote_id: string }>(`SELECT id, remote_id FROM models WHERE provider_id=? AND source='import'`, [providerId]);
    let retired = 0;
    for (const m of imported) if (!seen.has(m.remote_id)) { await this.db.run(`UPDATE models SET status='retired', updated_at=? WHERE id=?`, [now(), m.id]); retired++; }
    return { added: remoteIds.length, retired };
  }

  async recordTest(modelId: string, capabilityId: string, ok: boolean, httpStatus: number | null, message: string | null) {
    await this.db.run(`INSERT OR REPLACE INTO capability_tests (model_id, capability_id, status, http_status, message, checked_at) VALUES (?,?,?,?,?,?)`, [modelId, capabilityId, ok ? "ok" : "error", httpStatus, message, now()]);
  }

  async listModels(): Promise<ModelWithCaps[]> {
    const models = await this.db.all<RegistryModel & { provider_kind: string; provider_name: string; provider_enabled: number }>(
      `SELECT m.*, p.kind AS provider_kind, p.name AS provider_name, p.enabled AS provider_enabled FROM models m JOIN providers_registry p ON p.id=m.provider_id ORDER BY p.created_at, m.name`,
    );
    const caps = await this.db.all<{ model_id: string; capability_id: string }>(`SELECT model_id, capability_id FROM model_capabilities`);
    const tests = await this.db.all<CapabilityTest>(`SELECT * FROM capability_tests`);
    return models.map((m) => ({ ...m, capabilities: caps.filter((c) => c.model_id === m.id).map((c) => c.capability_id), tests: tests.filter((t) => t.model_id === m.id) }));
  }
}
