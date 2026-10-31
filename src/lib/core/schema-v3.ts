// Migration v3 — additive only. Global catalogs have no project_id; project data always does.
export const SCHEMA_V3 = [
  // ----- Global catalog -----
  `CREATE TABLE IF NOT EXISTS providers_registry (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, adapter TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, legacy_provider_id TEXT UNIQUE, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS capabilities (id TEXT PRIMARY KEY, spec TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, remote_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, cost_info TEXT, privacy TEXT NOT NULL DEFAULT 'external', context_tokens INTEGER, updated_at INTEGER NOT NULL, UNIQUE(provider_id, remote_id))`,
  `CREATE TABLE IF NOT EXISTS model_versions (id TEXT PRIMARY KEY, model_id TEXT NOT NULL, version TEXT NOT NULL, notes TEXT, created_at INTEGER NOT NULL, UNIQUE(model_id, version))`,
  `CREATE TABLE IF NOT EXISTS model_capabilities (model_id TEXT NOT NULL, capability_id TEXT NOT NULL, constraints TEXT, PRIMARY KEY (model_id, capability_id))`,
  `CREATE TABLE IF NOT EXISTS endpoints (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL UNIQUE, url TEXT, api_version TEXT, deployment TEXT)`,
  // Points at the existing encrypted credential (providers.api_key_enc); never stores a key itself.
  `CREATE TABLE IF NOT EXISTS auth_refs (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL UNIQUE, legacy_provider_id TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS capability_tests (model_id TEXT NOT NULL, capability_id TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER, message TEXT, checked_at INTEGER NOT NULL, PRIMARY KEY (model_id, capability_id))`,
  `CREATE TABLE IF NOT EXISTS key_versions (id INTEGER PRIMARY KEY, status TEXT NOT NULL, protection TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS device_reports (id TEXT PRIMARY KEY, device TEXT NOT NULL, report TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  // ----- Project-scoped (project_id NULL = global preference) -----
  `CREATE TABLE IF NOT EXISTS model_configs (id TEXT PRIMARY KEY, project_id TEXT, capability_id TEXT NOT NULL, mode TEXT NOT NULL, model_id TEXT, UNIQUE(project_id, capability_id))`,
  `CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, capability_id TEXT NOT NULL, provider_id TEXT, model_id TEXT, model_version TEXT, remote_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, phase TEXT NOT NULL, status TEXT NOT NULL, progress REAL, params TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, recovery TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS job_attempts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL, n INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT, error TEXT)`,
  `CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, format TEXT, size INTEGER NOT NULL, path TEXT NOT NULL, key_id INTEGER NOT NULL, wrapped_dek TEXT NOT NULL, enc_state TEXT NOT NULL, provider_id TEXT, model_id TEXT, capability_id TEXT, prompt TEXT, params TEXT, job_id TEXT, parent_id TEXT, version INTEGER NOT NULL DEFAULT 1, name TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS asset_tags (project_id TEXT NOT NULL, asset_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (asset_id, tag))`,
  `CREATE TABLE IF NOT EXISTS asset_relations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, from_asset TEXT NOT NULL, to_asset TEXT NOT NULL, relation TEXT NOT NULL, job_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS workflow_steps (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workflow_id TEXT NOT NULL, step_index INTEGER NOT NULL, capability_id TEXT NOT NULL, job_id TEXT, input_assets TEXT, output_assets TEXT, status TEXT NOT NULL, UNIQUE(workflow_id, step_index))`,
  // Voices created by the user (e.g. ElevenLabs cloning) — only the provider voice ID, never audio or keys.
  `CREATE TABLE IF NOT EXISTS voices (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, provider_id TEXT NOT NULL, voice_id TEXT NOT NULL, name TEXT NOT NULL, consent_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  // Phase 4–5: notes, tasks, semantic index, flashcards (all project-scoped).
  `CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, due_at INTEGER, priority INTEGER NOT NULL DEFAULT 2, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS embeddings (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, text TEXT NOT NULL, vector TEXT NOT NULL, model_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(project_id, source_type, source_id, chunk_index, model_id))`,
  `CREATE TABLE IF NOT EXISTS flashcards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, deck TEXT NOT NULL, front TEXT NOT NULL, back TEXT NOT NULL, ease REAL NOT NULL DEFAULT 2.5, interval_days REAL NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0, due_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_embeddings_project ON embeddings(project_id, model_id)`,
  // Preview-only blob store for encrypted asset bytes (native uses private files).
  `CREATE TABLE IF NOT EXISTS asset_blobs (path TEXT PRIMARY KEY, data BLOB NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id)`,
];

export const PROJECT_TABLES_V3 = ["jobs", "job_attempts", "assets", "asset_tags", "asset_relations", "workflow_steps", "model_configs", "voices", "notes", "tasks", "embeddings", "flashcards"] as const;
