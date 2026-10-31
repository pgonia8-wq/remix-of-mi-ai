// Minimal SQL executor abstraction. Native Android uses SQLCipher through
// @capacitor-community/sqlite; the web preview and tests use sql.js (same SQL).
export type Param = string | number | null;

export interface SqlDb {
  run(sql: string, params?: Param[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
}

type SqlJsDatabase = import("sql.js").Database;

export function wrapSqlJs(db: SqlJsDatabase, onChange?: () => void): SqlDb {
  return {
    async run(sql, params = []) {
      db.run(sql, params);
      onChange?.();
    },
    async all<T>(sql: string, params: Param[] = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      stmt.free();
      return rows;
    },
  };
}
