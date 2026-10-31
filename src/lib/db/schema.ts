export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, provider_id TEXT, model TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, provider_id TEXT, model TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS memory_items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL, content TEXT NOT NULL, version INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS memory_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, item_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL, text_content TEXT, file_path TEXT, created_at INTEGER NOT NULL)`,
  // api_key_enc holds AES-GCM ciphertext; the AES key lives in Android Keystore-backed storage.
  `CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, endpoint TEXT, api_key_enc TEXT, deployment TEXT, model TEXT NOT NULL, api_version TEXT, extra_params TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(project_id, chat_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_items(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_docs_project ON documents(project_id)`,
];
