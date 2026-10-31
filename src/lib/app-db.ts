// Platform bootstrap: native Android -> SQLCipher + Keystore; browser preview -> sql.js (dev only).
import { Capacitor } from "@capacitor/core";
import { Repo, type KeyVault } from "./db/repo";
import { wrapSqlJs, type SqlDb, type Param } from "./db/sql";
import { b64, decryptString, encryptString, importRawKey, randomBytes, unb64 } from "./crypto";

const VAULT_KEY_NAME = "miai_vault_key_v1";
const DB_NAME = "miai";

export const isNative = () => Capacitor.isNativePlatform();

async function getOrCreateVaultKey(): Promise<CryptoKey> {
  let raw: string | null = null;
  if (isNative()) {
    // Stored by the plugin in Android Keystore-protected storage.
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    raw = (await SecureStorage.get(VAULT_KEY_NAME, false, false)) as string | null;
    if (!raw) {
      raw = b64(randomBytes(32));
      await SecureStorage.set(VAULT_KEY_NAME, raw, false, false);
    }
  } else {
    // Preview only: not a secure store. The product always runs the native branch.
    raw = localStorage.getItem(VAULT_KEY_NAME);
    if (!raw) {
      raw = b64(randomBytes(32));
      localStorage.setItem(VAULT_KEY_NAME, raw);
    }
  }
  return importRawKey(unb64(raw));
}

export function makeVault(key: CryptoKey): KeyVault {
  return { encrypt: (p) => encryptString(key, p), decrypt: (c) => decryptString(key, c) };
}

async function openNativeDb(): Promise<SqlDb> {
  const { CapacitorSQLite, SQLiteConnection } = await import("@capacitor-community/sqlite");
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  // The plugin keeps the SQLCipher passphrase in Keystore-backed encrypted preferences.
  const stored = await sqlite.isSecretStored();
  if (!stored.result) await sqlite.setEncryptionSecret(b64(randomBytes(32)));
  const exists = (await sqlite.isConnection(DB_NAME, false)).result;
  const conn = exists
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, true, "secret", 1, false);
  await conn.open();
  return {
    async run(sql: string, params: Param[] = []) {
      await conn.run(sql, params, false);
    },
    async all<T>(sql: string, params: Param[] = []) {
      const r = await conn.query(sql, params);
      return (r.values ?? []) as T[];
    },
  };
}

const WEB_DB_KEY = "miai_preview_db";
async function openWebDb(): Promise<SqlDb> {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs({ locateFile: (file: string) => `/wasm/${file}` });
  const saved = localStorage.getItem(WEB_DB_KEY);
  const db = saved ? new SQL.Database(unb64(saved)) : new SQL.Database();
  let t: ReturnType<typeof setTimeout> | undefined;
  return wrapSqlJs(db, () => {
    clearTimeout(t);
    t = setTimeout(() => localStorage.setItem(WEB_DB_KEY, b64(db.export())), 150);
  });
}

let repoPromise: Promise<Repo> | null = null;
export function getRepo(): Promise<Repo> {
  if (!repoPromise) {
    repoPromise = (async () => {
      const key = await getOrCreateVaultKey();
      const db = isNative() ? await openNativeDb() : await openWebDb();
      const repo = new Repo(db, makeVault(key));
      await repo.migrate();
      return repo;
    })();
    repoPromise.catch(() => (repoPromise = null));
  }
  return repoPromise;
}
