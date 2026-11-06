import type { SqlDb } from "./sql";
import { SCHEMA } from "./schema";
import { SCHEMA_V3, PROJECT_TABLES_V3 } from "../core/schema-v3";
import { Registry } from "../core/registry";
import type { ChatAttachment } from "../chat-attachments";
import { exclusive } from "../core/operation-lock";
import { SCHEMA_B4, PROJECT_TABLES_B4 } from "../automation/schema-b4";

export interface KeyVault {
  encrypt(plain: string): Promise<string>;
  decrypt(cipher: string): Promise<string>;
}

export type Project = { id: string; name: string; description: string | null; created_at: number };
export const DEFAULT_CONTEXT_MESSAGES = 20;
export type Chat = { id: string; project_id: string; title: string; provider_id: string | null; model: string | null; created_at: number; updated_at: number };
export type Message = { id: string; project_id: string; chat_id: string; role: "user" | "assistant" | "system"; content: string; provider_id: string | null; model: string | null; created_at: number };
export type MemoryKind = "hecho" | "decision" | "hipotesis";
export type MemoryItem = { id: string; project_id: string; kind: MemoryKind; content: string; version: number; archived: number; updated_at: number };
export type MemoryVersion = { id: string; item_id: string; version: number; kind: MemoryKind; content: string; created_at: number };
export type Doc = { id: string; project_id: string; name: string; mime: string | null; size: number; text_content: string | null; file_path: string | null; created_at: number };
export type ProviderKind = "openai" | "anthropic" | "gemini" | "azure" | "azure_openai" | "xai" | "deepseek" | "mistral" | "cohere" | "openai_compatible" | "custom" | "elevenlabs" | "tavily" | "searxng" | "meshy" | "runway";
export type Provider = { id: string; name: string; kind: ProviderKind; endpoint: string | null; deployment: string | null; model: string; api_version: string | null; extra_params: string | null; enabled: number; created_at: number; has_key: boolean; verification_status: "verified" | "error" | "unverified"; checked_at: number | null };
export type ProviderInput = { name: string; kind: ProviderKind; endpoint?: string; apiKey?: string | undefined; deployment?: string; model: string; apiVersion?: string; extraParams?: string; enabled?: boolean };

// Free-form config columns may hold accidentally pasted credentials; backups redact recognizable secrets there.
const SECRET_COLUMNS = new Set(["params", "extra_params", "config", "detail", "headers", "metadata"]);
const SECRET_RE = /\b(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{16,})/g;
export function scrubSecrets(row: Record<string, unknown>) {
  const out = { ...row };
  for (const [k, v] of Object.entries(out)) if (SECRET_COLUMNS.has(k) && typeof v === "string") out[k] = v.replace(SECRET_RE, "[secreto eliminado]");
  return out;
}

export type ModelPrice = { model: string; input_per_mtok: number | null; output_per_mtok: number | null; per_image: number | null; per_second: number | null; per_call: number | null; updated_at: number };

export function budgetLevel(limitUsd: number | null, spentUsd: number, includesEstimates = false) {
  if (limitUsd === null) return { level: "none" as const, limitUsd, spentUsd, ratio: 0, includesEstimates };
  const ratio = spentUsd / limitUsd;
  return { level: ratio >= 1 ? "blocked" as const : ratio >= 0.8 ? "warn" as const : "ok" as const, limitUsd, spentUsd, ratio, includesEstimates };
}

export class IsolationError extends Error {}

// Catalog + project data from migration v3 included in backups. Excluded on purpose: capability_tests
// (verification claims reset on restore), key_versions (device-bound), asset_blobs (bytes travel separately).
const BACKUP_TABLES_V3 = ["capabilities", "providers_registry", "endpoints", "auth_refs", "models", "model_versions", "model_capabilities", "model_configs", "jobs", "job_attempts", "assets", "asset_tags", "asset_relations", "workflow_steps", "voices", "notes", "tasks", "embeddings", "flashcards", "agents", "workflows", "workflow_runs", "execution_events", "connections", "schedules", "workspace_items", "tool_favorites", "chat_attachments", "message_feedback", "project_budgets", "cost_ledger", "chat_settings", "message_status", "auto_runs", "auto_tasks", "local_ws_files", "local_ws_versions", "autonomy_prefs", "chat_job_links"] as const;

const uid = () => crypto.randomUUID();
const now = () => Date.now();

function need(projectId: string) {
  if (!projectId || typeof projectId !== "string") throw new IsolationError("projectId requerido");
}

export class Repo {
  constructor(private db: SqlDb, private vault: KeyVault) {
    this.registry = new Registry(db);
  }

  readonly registry: Registry;
  get sql(): SqlDb { return this.db; }
  /** Seals device-level secrets (PC Node keys) with the Keystore-backed vault; never stored in plaintext. */
  sealSecret(plain: string) { return this.vault.encrypt(plain); }
  openSecret(cipher: string) { return this.vault.decrypt(cipher); }

  async saveConnectionSecret(projectId: string, id: string, secret: string) {
    need(projectId);
    if (!(await this.db.all("SELECT id FROM connections WHERE project_id=? AND id=?", [projectId, id])).length) throw new IsolationError("Conexión ajena al proyecto");
    await this.db.run("INSERT OR REPLACE INTO connection_secrets VALUES (?,?,?)", [projectId, id, await this.vault.encrypt(secret)]);
  }
  async getConnectionSecret(projectId: string, id: string) {
    need(projectId);
    const [r] = await this.db.all<{ secret_enc: string }>("SELECT s.secret_enc FROM connection_secrets s JOIN connections c ON c.id=s.connection_id AND c.project_id=s.project_id WHERE s.project_id=? AND s.connection_id=?", [projectId, id]);
    return r ? this.vault.decrypt(r.secret_enc) : null;
  }

  async migrate() {
    for (const s of SCHEMA) await this.db.run(s);
    // v3 is additive: new tables only; existing rows are mirrored into the registry, never moved or deleted.
    for (const s of SCHEMA_V3) await this.db.run(s);
    await this.db.run(`CREATE TABLE IF NOT EXISTS project_states (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, archived INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS project_budgets (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, monthly_limit_usd REAL NOT NULL, updated_at INTEGER NOT NULL)`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS cost_ledger (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, provider_id TEXT, model TEXT, operation TEXT NOT NULL, amount_usd REAL NOT NULL, estimated INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS model_prices (model TEXT PRIMARY KEY, input_per_mtok REAL, output_per_mtok REAL, per_image REAL, per_second REAL, per_call REAL, updated_at INTEGER NOT NULL)`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS restore_journal (id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, detail TEXT, updated_at INTEGER NOT NULL)`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS chat_settings (chat_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, context_messages INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    // Provider "thinking" text some models (DeepSeek, Kimi) require back with tools; never shown, never exported.
    await this.db.run(`CREATE TABLE IF NOT EXISTS message_reasoning (message_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chat_id TEXT NOT NULL, content TEXT NOT NULL)`);
    // Answers saved while the model is still writing: "streaming" during generation, "interrupted" if it was cut off.
    await this.db.run(`CREATE TABLE IF NOT EXISTS crash_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, message TEXT NOT NULL)`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS content_reports (project_id TEXT NOT NULL, message_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(project_id, message_id))`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS chat_job_links (job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chat_id TEXT NOT NULL, message_id TEXT NOT NULL)`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS autonomy_prefs (project_id TEXT PRIMARY KEY, folder_id TEXT, node_id TEXT, ssh_id TEXT, model_id TEXT, role_choices TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL)`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS message_status (message_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chat_id TEXT NOT NULL, status TEXT NOT NULL)`);
    for (const s of SCHEMA_B4) await this.db.run(s);
    await this.registry.seedCapabilities();
    await this.registry.syncLegacyProviders();
  }

  // ---------- Projects ----------
  listProjects() {
    return this.db.all<Project>(`SELECT * FROM projects ORDER BY created_at DESC`);
  }
  async getProject(id: string) {
    return (await this.db.all<Project>(`SELECT * FROM projects WHERE id=?`, [id]))[0] ?? null;
  }
  async createProject(name: string, description = "") {
    const p: Project = { id: uid(), name, description, created_at: now() };
    await this.db.run(`INSERT INTO projects VALUES (?,?,?,?)`, [p.id, p.name, p.description, p.created_at]);
    return p;
  }
  async isProjectArchived(id: string) {
    const r = await this.db.all<{ archived: number }>(`SELECT archived FROM project_states WHERE project_id=?`, [id]);
    return r[0]?.archived === 1;
  }
  async listArchivedProjectIds() {
    return (await this.db.all<{ project_id: string }>(`SELECT project_id FROM project_states WHERE archived=1`)).map((r) => r.project_id);
  }
  async setProjectArchived(id: string, archived: boolean) {
    if (!(await this.getProject(id))) throw new IsolationError("Proyecto inexistente");
    await this.db.run(`INSERT OR REPLACE INTO project_states VALUES (?,?,?)`, [id, archived ? 1 : 0, now()]);
  }
  /** Copies chats, messages and active memory into a new project; credentials and files are not copied. */
  async duplicateProject(id: string) {
    const src = await this.getProject(id);
    if (!src) throw new IsolationError("Proyecto inexistente");
    return exclusive(this.db, async () => {
    await this.db.run("BEGIN TRANSACTION");
    try {
    const copy = await this.createProject(`${src.name} (copia)`, src.description ?? "");
    const chats = await this.db.all<{ id: string; title: string; provider_id: string | null; model: string | null; created_at: number; updated_at: number }>(`SELECT * FROM chats WHERE project_id=?`, [id]);
    for (const c of chats) {
      const nc = uid();
      await this.db.run(`INSERT INTO chats VALUES (?,?,?,?,?,?,?)`, [nc, copy.id, c.title, c.provider_id, c.model, c.created_at, c.updated_at]);
      const [cs] = await this.db.all<{ context_messages: number }>(`SELECT context_messages FROM chat_settings WHERE project_id=? AND chat_id=?`, [id, c.id]);
      if (cs) await this.db.run(`INSERT INTO chat_settings (chat_id, project_id, context_messages, updated_at) VALUES (?,?,?,?)`, [nc, copy.id, cs.context_messages, now()]);
      const statuses = new Map((await this.db.all<{ message_id: string; status: string }>(`SELECT message_id, status FROM message_status WHERE project_id=? AND chat_id=?`, [id, c.id])).map((r) => [r.message_id, r.status]));
      const msgs = await this.db.all<{ id: string; role: string; content: string; provider_id: string | null; model: string | null; created_at: number }>(`SELECT * FROM messages WHERE project_id=? AND chat_id=? ORDER BY created_at`, [id, c.id]);
      for (const m of msgs) {
        const nm = uid();
        await this.db.run(`INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)`, [nm, copy.id, nc, m.role, m.content, m.provider_id, m.model, m.created_at]);
        const st = statuses.get(m.id);
        if (st) await this.db.run(`INSERT INTO message_status (message_id, project_id, chat_id, status) VALUES (?,?,?,?)`, [nm, copy.id, nc, st === "streaming" ? "interrupted" : st]);
      }
    }
    const mem = await this.db.all<MemoryItem>(`SELECT * FROM memory_items WHERE project_id=? AND archived=0`, [id]);
    for (const m of mem) await this.db.run(`INSERT INTO memory_items VALUES (?,?,?,?,?,?,?)`, [uid(), copy.id, m.kind, m.content, 1, 0, now()]);
    await this.db.run("COMMIT");
    return copy;
    } catch (error) { await this.db.run("ROLLBACK"); throw error; }
    });
  }
  async renameProject(id: string, name: string, description: string) {
    await this.db.run(`UPDATE projects SET name=?, description=? WHERE id=?`, [name, description, id]);
  }
  async deleteProject(id: string) {
    for (const t of ["content_reports", "chat_job_links", "autonomy_prefs", "cost_ledger", "project_budgets", "chat_settings", "message_reasoning", "message_status", "messages", "chats", "memory_versions", "memory_items", "documents", ...PROJECT_TABLES_V3, ...PROJECT_TABLES_B4])
      await this.db.run(`DELETE FROM ${t} WHERE project_id=?`, [id]);
    await this.db.run(`DELETE FROM projects WHERE id=?`, [id]);
  }

  /** Device-local diagnostics (already redacted by the caller); never part of backups. */
  async addCrash(message: string, keep = 50) {
    await this.db.run(`INSERT INTO crash_log (at, message) VALUES (?,?)`, [now(), message]);
    await this.db.run(`DELETE FROM crash_log WHERE id NOT IN (SELECT id FROM crash_log ORDER BY id DESC LIMIT ?)`, [keep]);
  }
  async listCrashes() { return this.db.all<{ at: number; message: string }>(`SELECT at, message FROM crash_log ORDER BY id DESC`); }
  async clearCrashes() { await this.db.run(`DELETE FROM crash_log`); }
  async reportMessage(projectId: string, messageId: string, reason: string) {
    need(projectId);
    const [m] = await this.db.all(`SELECT id FROM messages WHERE project_id=? AND id=?`, [projectId, messageId]);
    if (!m) throw new IsolationError("Mensaje ajeno al proyecto");
    await this.db.run(`INSERT OR REPLACE INTO content_reports VALUES (?,?,?,?)`, [projectId, messageId, reason.slice(0, 500), now()]);
  }
  async listReported(projectId: string) { need(projectId); return this.db.all<{ message_id: string }>(`SELECT message_id FROM content_reports WHERE project_id=?`, [projectId]); }
  /** Slow media jobs started from a chat answer: when they finish, their files attach to that message. */
  async linkJobsToMessage(projectId: string, chatId: string, messageId: string, since: number) {
    need(projectId);
    const jobs = await this.db.all<{ id: string }>(`SELECT id FROM jobs WHERE project_id=? AND created_at>=? AND status IN ('queued','processing','pending')`, [projectId, since]);
    for (const j of jobs) await this.db.run(`INSERT OR REPLACE INTO chat_job_links VALUES (?,?,?,?)`, [j.id, projectId, chatId, messageId]);
    return jobs.length;
  }
  async attachFinishedJob(projectId: string, jobId: string, assetIds: string[]) {
    need(projectId);
    const [l] = await this.db.all<{ chat_id: string; message_id: string }>(`SELECT chat_id, message_id FROM chat_job_links WHERE project_id=? AND job_id=?`, [projectId, jobId]);
    if (!l) return null;
    for (const a of assetIds) await this.attachToMessage(projectId, l.chat_id, l.message_id, a, null);
    await this.db.run(`DELETE FROM chat_job_links WHERE project_id=? AND job_id=?`, [projectId, jobId]);
    return l;
  }
  /** Last team setup chosen in Sistema autónomo; chat delegation reuses it so PC/VM and models are not lost. */
  async setAutonomyPrefs(projectId: string, p: { folderId: string | null; nodeId: string | null; sshId: string | null; modelId: string | null; roleChoices: Record<string, string> }) {
    need(projectId);
    if (!(await this.getProject(projectId))) throw new IsolationError("Proyecto inexistente");
    await this.db.run(`INSERT OR REPLACE INTO autonomy_prefs VALUES (?,?,?,?,?,?,?)`, [projectId, p.folderId, p.nodeId, p.sshId, p.modelId, JSON.stringify(p.roleChoices ?? {}), now()]);
  }
  async getAutonomyPrefs(projectId: string) {
    need(projectId);
    const [r] = await this.db.all<{ folder_id: string | null; node_id: string | null; ssh_id: string | null; model_id: string | null; role_choices: string }>(`SELECT * FROM autonomy_prefs WHERE project_id=?`, [projectId]);
    if (!r) return null;
    let roleChoices: Record<string, string> = {};
    try { const v = JSON.parse(r.role_choices); if (v && typeof v === "object") roleChoices = v; } catch { /* corrupt → empty */ }
    return { folderId: r.folder_id, nodeId: r.node_id, sshId: r.ssh_id, modelId: r.model_id, roleChoices };
  }

  // ---------- Costs & budgets ----------
  async setProjectBudget(projectId: string, monthlyLimitUsd: number | null) {
    need(projectId);
    if (!(await this.getProject(projectId))) throw new IsolationError("Proyecto inexistente");
    if (monthlyLimitUsd === null) { await this.db.run(`DELETE FROM project_budgets WHERE project_id=?`, [projectId]); return; }
    if (!Number.isFinite(monthlyLimitUsd) || monthlyLimitUsd <= 0) throw new Error("El presupuesto debe ser mayor que cero");
    await this.db.run(`INSERT OR REPLACE INTO project_budgets VALUES (?,?,?)`, [projectId, monthlyLimitUsd, now()]);
  }
  async getProjectBudget(projectId: string) {
    need(projectId);
    return (await this.db.all<{ monthly_limit_usd: number }>(`SELECT monthly_limit_usd FROM project_budgets WHERE project_id=?`, [projectId]))[0]?.monthly_limit_usd ?? null;
  }
  async listModelPrices() { return this.db.all<ModelPrice>(`SELECT * FROM model_prices ORDER BY model`); }
  async getModelPrice(model: string) { return (await this.db.all<ModelPrice>(`SELECT * FROM model_prices WHERE model=?`, [model]))[0] ?? null; }
  async setModelPrice(p: Omit<ModelPrice, "updated_at">) {
    for (const v of [p.input_per_mtok, p.output_per_mtok, p.per_image, p.per_second, p.per_call]) if (v !== null && (!Number.isFinite(v) || v < 0)) throw new Error("Tarifa inválida");
    await this.db.run(`INSERT OR REPLACE INTO model_prices VALUES (?,?,?,?,?,?,?)`, [p.model, p.input_per_mtok, p.output_per_mtok, p.per_image, p.per_second, p.per_call, now()]);
  }
  async deleteModelPrice(model: string) { await this.db.run(`DELETE FROM model_prices WHERE model=?`, [model]); }
  async listCosts(projectId: string, limit = 50) {
    need(projectId);
    return this.db.all<{ id: string; model: string | null; operation: string; amount_usd: number; estimated: number; created_at: number }>(`SELECT id, model, operation, amount_usd, estimated, created_at FROM cost_ledger WHERE project_id=? ORDER BY created_at DESC LIMIT ?`, [projectId, limit]);
  }
  // ---------- Resumable restore / key-rotation journal (device-level) ----------
  async journalStart(kind: string, detail: unknown) { const id = uid(); await this.db.run(`INSERT INTO restore_journal VALUES (?,?,?,?,?)`, [id, kind, "started", JSON.stringify(detail ?? null), now()]); return id; }
  async journalSet(id: string, state: "applied" | "committed" | "rolled_back", detail?: unknown) { await this.db.run(`UPDATE restore_journal SET state=?, detail=COALESCE(?,detail), updated_at=? WHERE id=?`, [state, detail === undefined ? null : JSON.stringify(detail), now(), id]); }
  async journalPending() { return this.db.all<{ id: string; kind: string; state: string; detail: string | null }>(`SELECT id, kind, state, detail FROM restore_journal WHERE state IN ('started','applied') ORDER BY updated_at`); }
  /** Records a call's cost. pricing: exact (provider-reported), estimated (local price table), unpriced (no known price). */
  async recordCost(projectId: string, c: { providerId?: string | null; model?: string | null; operation: string; amountUsd: number; estimated: boolean | "unpriced"; at?: number }) {
    need(projectId);
    if (!Number.isFinite(c.amountUsd) || c.amountUsd < 0) throw new Error("Costo inválido");
    await this.db.run(`INSERT INTO cost_ledger VALUES (?,?,?,?,?,?,?,?)`, [uid(), projectId, c.providerId ?? null, c.model ?? null, c.operation, c.amountUsd, c.estimated === "unpriced" ? 2 : c.estimated ? 1 : 0, c.at ?? now()]);
  }
  async monthSpend(projectId: string, at = now()) {
    need(projectId);
    const d = new Date(at); const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const [r] = await this.db.all<{ total: number | null; est: number | null }>(`SELECT SUM(amount_usd) total, MAX(CASE WHEN estimated>0 THEN 1 ELSE 0 END) est FROM cost_ledger WHERE project_id=? AND created_at>=?`, [projectId, start]);
    return { totalUsd: r?.total ?? 0, includesEstimates: (r?.est ?? 0) === 1 };
  }
  /** ok <80%, warn 80–99%, blocked >=100% (the user may still confirm manually). */
  async budgetStatus(projectId: string, nextCostUsd = 0, at = now()) {
    const limit = await this.getProjectBudget(projectId);
    const spend = await this.monthSpend(projectId, at);
    return budgetLevel(limit, spend.totalUsd + nextCostUsd, spend.includesEstimates);
  }

  // ---------- Chats ----------
  listChats(projectId: string) {
    need(projectId);
    return this.db.all<Chat>(`SELECT * FROM chats WHERE project_id=? ORDER BY updated_at DESC`, [projectId]);
  }
  async getChat(projectId: string, chatId: string) {
    need(projectId);
    return (await this.db.all<Chat>(`SELECT * FROM chats WHERE project_id=? AND id=?`, [projectId, chatId]))[0] ?? null;
  }
  async createChat(projectId: string, title = "Nuevo chat") {
    need(projectId);
    if (!(await this.getProject(projectId))) throw new IsolationError("Proyecto inexistente");
    const c: Chat = { id: uid(), project_id: projectId, title, provider_id: null, model: null, created_at: now(), updated_at: now() };
    await this.db.run(`INSERT INTO chats VALUES (?,?,?,?,?,?,?)`, [c.id, c.project_id, c.title, null, null, c.created_at, c.updated_at]);
    return c;
  }
  async updateChat(projectId: string, chatId: string, patch: { title?: string; provider_id?: string | null; model?: string | null }) {
    const c = await this.getChat(projectId, chatId);
    if (!c) throw new IsolationError("Chat no pertenece al proyecto");
    await this.db.run(`UPDATE chats SET title=?, provider_id=?, model=?, updated_at=? WHERE id=? AND project_id=?`, [
      patch.title ?? c.title,
      patch.provider_id !== undefined ? patch.provider_id : c.provider_id,
      patch.model !== undefined ? patch.model : c.model,
      now(),
      chatId,
      projectId,
    ]);
  }
  async deleteChat(projectId: string, chatId: string) {
    need(projectId);
    await this.db.run(`DELETE FROM message_feedback WHERE project_id=? AND message_id IN (SELECT id FROM messages WHERE project_id=? AND chat_id=?)`, [projectId, projectId, chatId]);
    await this.db.run(`DELETE FROM chat_attachments WHERE project_id=? AND chat_id=?`, [projectId, chatId]);
    await this.db.run(`DELETE FROM chat_settings WHERE project_id=? AND chat_id=?`, [projectId, chatId]);
    await this.db.run(`DELETE FROM message_reasoning WHERE project_id=? AND chat_id=?`, [projectId, chatId]);
    await this.db.run(`DELETE FROM message_status WHERE project_id=? AND chat_id=?`, [projectId, chatId]);
    await this.db.run(`DELETE FROM messages WHERE project_id=? AND chat_id=?`, [projectId, chatId]);
    await this.db.run(`DELETE FROM chats WHERE project_id=? AND id=?`, [projectId, chatId]);
  }
  /** Messages of history sent per request; 0 = unlimited. The chat itself stores every message regardless. */
  async getChatContextLimit(projectId: string, chatId: string): Promise<number> {
    need(projectId);
    const [r] = await this.db.all<{ context_messages: number }>(`SELECT context_messages FROM chat_settings WHERE project_id=? AND chat_id=?`, [projectId, chatId]);
    return r ? r.context_messages : DEFAULT_CONTEXT_MESSAGES;
  }
  async setChatContextLimit(projectId: string, chatId: string, messages: number) {
    if (!Number.isInteger(messages) || messages < 0) throw new Error("Cantidad de mensajes de contexto inválida");
    if (!(await this.getChat(projectId, chatId))) throw new IsolationError("Chat no pertenece al proyecto");
    await this.db.run(`INSERT OR REPLACE INTO chat_settings (chat_id, project_id, context_messages, updated_at) VALUES (?,?,?,?)`, [chatId, projectId, messages, now()]);
  }

  // ---------- Messages ----------
  listMessages(projectId: string, chatId: string) {
    need(projectId);
    return this.db.all<Message>(`SELECT * FROM messages WHERE project_id=? AND chat_id=? ORDER BY created_at ASC`, [projectId, chatId]);
  }
  async addMessage(projectId: string, chatId: string, role: Message["role"], content: string, providerId?: string | null, model?: string | null) {
    if (!(await this.getChat(projectId, chatId))) throw new IsolationError("Chat no pertenece al proyecto");
    const m: Message = { id: uid(), project_id: projectId, chat_id: chatId, role, content, provider_id: providerId ?? null, model: model ?? null, created_at: now() };
    await this.db.run(`INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)`, [m.id, projectId, chatId, role, content, m.provider_id, m.model, m.created_at]);
    await this.db.run(`UPDATE chats SET updated_at=? WHERE id=? AND project_id=?`, [m.created_at, chatId, projectId]);
    return m;
  }
  async updateMessage(projectId: string, messageId: string, content: string) {
    need(projectId);
    await this.db.run(`UPDATE messages SET content=? WHERE id=? AND project_id=?`, [content, messageId, projectId]);
  }
  async setMessageStatus(projectId: string, chatId: string, messageId: string, status: "streaming" | "interrupted" | null) {
    const [m] = await this.db.all("SELECT id FROM messages WHERE project_id=? AND chat_id=? AND id=?", [projectId, chatId, messageId]);
    if (!m) throw new IsolationError("Mensaje ajeno al proyecto");
    if (!status) { await this.db.run("DELETE FROM message_status WHERE project_id=? AND message_id=?", [projectId, messageId]); return; }
    await this.db.run("INSERT OR REPLACE INTO message_status (message_id, project_id, chat_id, status) VALUES (?,?,?,?)", [messageId, projectId, chatId, status]);
  }
  listMessageStatus(projectId: string, chatId: string) {
    need(projectId);
    return this.db.all<{ message_id: string; status: "streaming" | "interrupted" }>("SELECT message_id, status FROM message_status WHERE project_id=? AND chat_id=?", [projectId, chatId]);
  }
  /** Answers left "streaming" by a closed/killed app become "interrupted" (except ones still being written now). */
  async interruptStaleMessages(projectId: string, chatId: string, active: string[] = []) {
    need(projectId);
    const rows = await this.listMessageStatus(projectId, chatId);
    let n = 0;
    for (const r of rows) if (r.status === "streaming" && !active.includes(r.message_id)) { await this.db.run("UPDATE message_status SET status='interrupted' WHERE project_id=? AND message_id=?", [projectId, r.message_id]); n++; }
    return n;
  }
  async setMessageReasoning(projectId: string, chatId: string, messageId: string, content: string) {
    const [m] = await this.db.all("SELECT id FROM messages WHERE project_id=? AND chat_id=? AND id=?", [projectId, chatId, messageId]);
    if (!m) throw new IsolationError("Mensaje ajeno al proyecto");
    if (!content) { await this.db.run("DELETE FROM message_reasoning WHERE project_id=? AND message_id=?", [projectId, messageId]); return; }
    await this.db.run("INSERT OR REPLACE INTO message_reasoning (message_id, project_id, chat_id, content) VALUES (?,?,?,?)", [messageId, projectId, chatId, content]);
  }
  async listMessageReasoning(projectId: string, chatId: string) {
    need(projectId);
    return this.db.all<{ message_id: string; content: string }>("SELECT message_id, content FROM message_reasoning WHERE project_id=? AND chat_id=?", [projectId, chatId]);
  }
  listChatAttachments(projectId: string, chatId: string) {
    need(projectId);
    return this.db.all<ChatAttachment>("SELECT * FROM chat_attachments WHERE project_id=? AND chat_id=?", [projectId, chatId]);
  }
  async attachToMessage(projectId: string, chatId: string, messageId: string, assetId: string, text: string | null) {
    if (!await this.getChat(projectId, chatId)) throw new IsolationError("Chat ajeno al proyecto");
    const [message] = await this.db.all("SELECT id FROM messages WHERE project_id=? AND chat_id=? AND id=?", [projectId, chatId, messageId]);
    const [asset] = await this.db.all<{ name: string | null; mime: string }>("SELECT name,mime FROM assets WHERE project_id=? AND id=?", [projectId, assetId]);
    if (!message || !asset) throw new IsolationError("Mensaje o archivo ajeno al proyecto");
    await this.db.run("INSERT INTO chat_attachments VALUES (?,?,?,?,?,?,?,?)", [uid(), projectId, chatId, messageId, assetId, asset.name ?? "archivo", asset.mime, text]);
  }
  messageFeedback(projectId: string, chatId: string) {
    need(projectId);
    return this.db.all<{ message_id: string; value: string }>("SELECT f.message_id,f.value FROM message_feedback f JOIN messages m ON m.id=f.message_id AND m.project_id=f.project_id WHERE f.project_id=? AND m.chat_id=?", [projectId, chatId]);
  }
  async setMessageFeedback(projectId: string, messageId: string, value: "like" | "dislike" | null) {
    need(projectId);
    if (!(await this.db.all("SELECT id FROM messages WHERE project_id=? AND id=?", [projectId, messageId])).length) throw new IsolationError("Mensaje ajeno al proyecto");
    if (value === null) await this.db.run("DELETE FROM message_feedback WHERE project_id=? AND message_id=?", [projectId, messageId]);
    else await this.db.run("INSERT OR REPLACE INTO message_feedback VALUES (?,?,?)", [projectId, messageId, value]);
  }

  // ---------- Memory (versioned, never touches messages) ----------
  listMemory(projectId: string, includeArchived = false) {
    need(projectId);
    return this.db.all<MemoryItem>(
      `SELECT * FROM memory_items WHERE project_id=? ${includeArchived ? "" : "AND archived=0"} ORDER BY updated_at DESC`,
      [projectId],
    );
  }
  async addMemory(projectId: string, kind: MemoryKind, content: string) {
    need(projectId);
    if (!(await this.getProject(projectId))) throw new IsolationError("Proyecto inexistente");
    const id = uid();
    const t = now();
    await this.db.run(`INSERT INTO memory_items VALUES (?,?,?,?,?,?,?)`, [id, projectId, kind, content, 1, 0, t]);
    await this.db.run(`INSERT INTO memory_versions VALUES (?,?,?,?,?,?,?)`, [uid(), projectId, id, 1, kind, content, t]);
    return id;
  }
  async editMemory(projectId: string, itemId: string, kind: MemoryKind, content: string) {
    need(projectId);
    const [it] = await this.db.all<MemoryItem>(`SELECT * FROM memory_items WHERE id=? AND project_id=?`, [itemId, projectId]);
    if (!it) throw new IsolationError("Memoria no pertenece al proyecto");
    const v = it.version + 1;
    const t = now();
    await this.db.run(`UPDATE memory_items SET kind=?, content=?, version=?, updated_at=? WHERE id=? AND project_id=?`, [kind, content, v, t, itemId, projectId]);
    await this.db.run(`INSERT INTO memory_versions VALUES (?,?,?,?,?,?,?)`, [uid(), projectId, itemId, v, kind, content, t]);
  }
  async archiveMemory(projectId: string, itemId: string, archived: boolean) {
    need(projectId);
    await this.db.run(`UPDATE memory_items SET archived=?, updated_at=? WHERE id=? AND project_id=?`, [archived ? 1 : 0, now(), itemId, projectId]);
  }
  memoryHistory(projectId: string, itemId: string) {
    need(projectId);
    return this.db.all<MemoryVersion>(`SELECT * FROM memory_versions WHERE project_id=? AND item_id=? ORDER BY version DESC`, [projectId, itemId]);
  }

  // ---------- Documents ----------
  listDocs(projectId: string) {
    need(projectId);
    return this.db.all<Doc>(`SELECT * FROM documents WHERE project_id=? ORDER BY created_at DESC`, [projectId]);
  }
  async addDoc(projectId: string, d: { name: string; mime: string; size: number; text: string | null; filePath: string | null }) {
    need(projectId);
    if (!(await this.getProject(projectId))) throw new IsolationError("Proyecto inexistente");
    const id = uid();
    await this.db.run(`INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)`, [id, projectId, d.name, d.mime, d.size, d.text, d.filePath, now()]);
    return id;
  }
  async deleteDoc(projectId: string, docId: string) {
    need(projectId);
    const [d] = await this.db.all<Doc>(`SELECT * FROM documents WHERE id=? AND project_id=?`, [docId, projectId]);
    await this.db.run(`DELETE FROM documents WHERE id=? AND project_id=?`, [docId, projectId]);
    return d ?? null;
  }

  /** Local full-text search, always scoped to one project. */
  async search(projectId: string, q: string) {
    need(projectId);
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const [messages, memory, docs] = await Promise.all([
      this.db.all<Message>(`SELECT * FROM messages WHERE project_id=? AND content LIKE ? ORDER BY created_at DESC LIMIT 30`, [projectId, like]),
      this.db.all<MemoryItem>(`SELECT * FROM memory_items WHERE project_id=? AND archived=0 AND content LIKE ? LIMIT 30`, [projectId, like]),
      this.db.all<Doc>(`SELECT * FROM documents WHERE project_id=? AND (name LIKE ? OR text_content LIKE ?) LIMIT 30`, [projectId, like, like]),
    ]);
    return { messages, memory, docs };
  }

  /** System context injected into the model: only this project's memory and relevant docs. */
  async buildContext(projectId: string, query: string): Promise<string> {
    need(projectId);
    const project = await this.getProject(projectId);
    if (!project) throw new IsolationError("Proyecto inexistente");
    const memory = await this.listMemory(projectId);
    const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 6);
    const docs = await this.listDocs(projectId);
    const relevant = docs
      .filter((d) => d.text_content && words.some((w) => d.text_content!.toLowerCase().includes(w) || d.name.toLowerCase().includes(w)))
      .slice(0, 3);
    const parts = [`Proyecto: ${project.name}${project.description ? ` — ${project.description}` : ""}`];
    if (memory.length) parts.push("Memoria del proyecto:\n" + memory.map((m) => `- [${m.kind}] ${m.content}`).join("\n"));
    if (relevant.length)
      parts.push("Documentos relevantes:\n" + relevant.map((d) => `### ${d.name}\n${d.text_content!.slice(0, 4000)}`).join("\n\n"));
    return parts.join("\n\n");
  }

  // ---------- Providers ----------
  async listProviders(): Promise<Provider[]> {
    const rows = await this.db.all<Omit<Provider, "has_key"> & { api_key_enc: string | null }>(`SELECT p.*, COALESCE(v.status, 'unverified') AS verification_status, v.checked_at FROM providers p LEFT JOIN provider_verifications v ON v.provider_id=p.id ORDER BY p.created_at ASC`);
    return rows.map(({ api_key_enc, ...r }) => ({ ...r, has_key: !!api_key_enc }));
  }
  async saveProvider(input: ProviderInput, id?: string) {
    const enc = input.apiKey ? await this.vault.encrypt(input.apiKey) : null;
    if (id) {
      await this.db.run(`DELETE FROM provider_verifications WHERE provider_id=?`, [id]);
      // Any config change invalidates every capability test of this provider's models (endpoint/key/version fingerprint).
      await this.db.run(`DELETE FROM capability_tests WHERE model_id IN (SELECT m.id FROM models m JOIN auth_refs a ON a.provider_id=m.provider_id WHERE a.legacy_provider_id=?)`, [id]).catch(() => undefined);
      await this.db.run(
        `UPDATE providers SET name=?, kind=?, endpoint=?, deployment=?, model=?, api_version=?, extra_params=?, enabled=? ${enc ? ", api_key_enc=?" : ""} WHERE id=?`,
        [input.name, input.kind, input.endpoint ?? null, input.deployment ?? null, input.model, input.apiVersion ?? null, input.extraParams ?? null, input.enabled === false ? 0 : 1, ...(enc ? [enc] : []), id],
      );
      await this.registry.syncLegacyProviders();
      return id;
    }
    const nid = uid();
    await this.db.run(`INSERT INTO providers VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
      nid, input.name, input.kind, input.endpoint ?? null, enc, input.deployment ?? null, input.model, input.apiVersion ?? null, input.extraParams ?? null, input.enabled === false ? 0 : 1, now(),
    ]);
    await this.registry.syncLegacyProviders();
    return nid;
  }
  async setProviderEnabled(id: string, enabled: boolean) {
    await this.db.run(`UPDATE providers SET enabled=? WHERE id=?`, [enabled ? 1 : 0, id]);
    await this.registry.syncLegacyProviders();
  }
  async deleteProvider(id: string) {
    await this.db.run(`DELETE FROM provider_verifications WHERE provider_id=?`, [id]);
    await this.db.run(`DELETE FROM providers WHERE id=?`, [id]);
    await this.registry.syncLegacyProviders();
  }
  async setProviderVerification(id: string, status: "verified" | "error") {
    await this.db.run(`INSERT OR REPLACE INTO provider_verifications (provider_id,status,checked_at) VALUES (?,?,?)`, [id, status, now()]);
  }
  /** Decrypts the key only at call time; never cached or logged. */
  async getProviderSecret(id: string): Promise<string | null> {
    const [r] = await this.db.all<{ api_key_enc: string | null }>(`SELECT api_key_enc FROM providers WHERE id=?`, [id]);
    return r?.api_key_enc ? this.vault.decrypt(r.api_key_enc) : null;
  }

  // ---------- Export / import (API keys never included) ----------
  async dumpAll() {
    const tables = ["projects", "chats", "messages", "memory_items", "memory_versions", "documents", ...BACKUP_TABLES_V3] as const;
    const out: Record<string, unknown[]> = {};
    for (const t of tables) out[t] = (await this.db.all<Record<string, unknown>>(`SELECT * FROM ${t}`)).map(scrubSecrets);
    const providers = await this.listProviders();
    out["providers"] = providers.map(({ has_key: _h, verification_status: _v, checked_at: _t, ...p }) => p); // without credentials or verification claims
    return { app: "MI AI", v: 1, exportedAt: now(), tables: out };
  }
  async restoreAll(dump: { tables: Record<string, Record<string, unknown>[]> }) {
    return exclusive(this.db, () => this.restoreAllLocked(dump));
  }
  private async restoreAllLocked(dump: { tables: Record<string, Record<string, unknown>[]> }) {
    const order = ["projects", "chats", "messages", "memory_items", "memory_versions", "documents", "providers", ...BACKUP_TABLES_V3];
    // Validate EVERYTHING before writing: known tables, allowlisted columns, scalar values, and project→chat→message coherence.
    const allowed: Record<string, Set<string>> = {};
    for (const t of order) allowed[t] = new Set((await this.db.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
    for (const t of Object.keys(dump.tables ?? {})) if (!allowed[t] && dump.tables[t]?.length) throw new Error(`Respaldo con tabla no admitida: ${t}`);
    const projects = new Set([...(dump.tables["projects"] ?? []).map((r) => r["id"]), ...(await this.listProjects()).map((p) => p.id)]);
    const chatProject = new Map<unknown, unknown>([...(dump.tables["chats"] ?? []).map((r) => [r["id"], r["project_id"]] as const), ...(await this.db.all<{ id: string; project_id: string }>(`SELECT id, project_id FROM chats`)).map((r) => [r.id, r.project_id] as const)]);
    for (const t of order) for (const row of dump.tables[t] ?? []) {
      if (!row || typeof row !== "object") throw new Error(`Fila inválida en ${t}`);
      for (const [c, v] of Object.entries(row)) {
        if (!allowed[t]?.has(c) && c !== "has_key") throw new Error(`Respaldo con columna no admitida: ${t}.${c}`);
        if (v !== null && !["string", "number"].includes(typeof v)) throw new Error(`Valor no admitido en ${t}.${c}`);
      }
      if (allowed[t]?.has("project_id") && t !== "projects" && row["project_id"] != null && !projects.has(row["project_id"])) throw new Error(`Respaldo incoherente: ${t} apunta a un proyecto inexistente`);
      if (t === "messages" && chatProject.get(row["chat_id"]) !== row["project_id"]) throw new Error("Respaldo incoherente: mensaje de otro proyecto");
    }
    await this.db.run("BEGIN TRANSACTION");
    try {
    for (const t of order) {
      for (const row of dump.tables[t] ?? []) {
        const cols = Object.keys(row).filter((c) => c !== "api_key_enc" && c !== "has_key");
        await this.db.run(
          `INSERT OR REPLACE INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
          cols.map((c) => row[c] as string | number | null),
        );
        if (t === "providers") await this.db.run(`DELETE FROM provider_verifications WHERE provider_id=?`, [row["id"] as string]);
      }
    }
    await this.registry.syncLegacyProviders();
    await this.db.run("COMMIT");
    } catch (error) { await this.db.run("ROLLBACK"); throw error; }
  }
}
