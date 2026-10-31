import type { SqlDb } from "./sql";
import { SCHEMA } from "./schema";
import { SCHEMA_V3, PROJECT_TABLES_V3 } from "../core/schema-v3";
import { Registry } from "../core/registry";

export interface KeyVault {
  encrypt(plain: string): Promise<string>;
  decrypt(cipher: string): Promise<string>;
}

export type Project = { id: string; name: string; description: string | null; created_at: number };
export type Chat = { id: string; project_id: string; title: string; provider_id: string | null; model: string | null; created_at: number; updated_at: number };
export type Message = { id: string; project_id: string; chat_id: string; role: "user" | "assistant" | "system"; content: string; provider_id: string | null; model: string | null; created_at: number };
export type MemoryKind = "hecho" | "decision" | "hipotesis";
export type MemoryItem = { id: string; project_id: string; kind: MemoryKind; content: string; version: number; archived: number; updated_at: number };
export type MemoryVersion = { id: string; item_id: string; version: number; kind: MemoryKind; content: string; created_at: number };
export type Doc = { id: string; project_id: string; name: string; mime: string | null; size: number; text_content: string | null; file_path: string | null; created_at: number };
export type ProviderKind = "openai" | "anthropic" | "gemini" | "azure" | "azure_openai" | "xai" | "deepseek" | "mistral" | "cohere" | "openai_compatible" | "custom" | "elevenlabs" | "tavily";
export type Provider = { id: string; name: string; kind: ProviderKind; endpoint: string | null; deployment: string | null; model: string; api_version: string | null; extra_params: string | null; enabled: number; created_at: number; has_key: boolean; verification_status: "verified" | "error" | "unverified"; checked_at: number | null };
export type ProviderInput = { name: string; kind: ProviderKind; endpoint?: string; apiKey?: string | undefined; deployment?: string; model: string; apiVersion?: string; extraParams?: string; enabled?: boolean };

export class IsolationError extends Error {}

// Catalog + project data from migration v3 included in backups. Excluded on purpose: capability_tests
// (verification claims reset on restore), key_versions (device-bound), asset_blobs (bytes travel separately).
const BACKUP_TABLES_V3 = ["capabilities", "providers_registry", "endpoints", "auth_refs", "models", "model_versions", "model_capabilities", "model_configs", "jobs", "job_attempts", "assets", "asset_tags", "asset_relations", "workflow_steps", "voices", "notes", "tasks", "embeddings", "flashcards", "agents", "workflows", "workflow_runs", "execution_events"] as const;

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

  async migrate() {
    for (const s of SCHEMA) await this.db.run(s);
    // v3 is additive: new tables only; existing rows are mirrored into the registry, never moved or deleted.
    for (const s of SCHEMA_V3) await this.db.run(s);
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
  async renameProject(id: string, name: string, description: string) {
    await this.db.run(`UPDATE projects SET name=?, description=? WHERE id=?`, [name, description, id]);
  }
  async deleteProject(id: string) {
    for (const t of ["messages", "chats", "memory_versions", "memory_items", "documents", ...PROJECT_TABLES_V3])
      await this.db.run(`DELETE FROM ${t} WHERE project_id=?`, [id]);
    await this.db.run(`DELETE FROM projects WHERE id=?`, [id]);
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
    await this.db.run(`DELETE FROM messages WHERE project_id=? AND chat_id=?`, [projectId, chatId]);
    await this.db.run(`DELETE FROM chats WHERE project_id=? AND id=?`, [projectId, chatId]);
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
    for (const t of tables) out[t] = await this.db.all(`SELECT * FROM ${t}`);
    const providers = await this.listProviders();
    out["providers"] = providers.map(({ has_key: _h, verification_status: _v, checked_at: _t, ...p }) => p); // without credentials or verification claims
    return { app: "MI AI", v: 1, exportedAt: now(), tables: out };
  }
  async restoreAll(dump: { tables: Record<string, Record<string, unknown>[]> }) {
    const order = ["projects", "chats", "messages", "memory_items", "memory_versions", "documents", "providers", ...BACKUP_TABLES_V3];
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
  }
}
