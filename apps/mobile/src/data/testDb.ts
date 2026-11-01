// テストの SQLite。Node に組み込みの node:sqlite で、端末と同じ SQL を実際に動かす
import { DatabaseSync } from "node:sqlite";

import type { Database, SqlValue } from "./db.ts";

export function openTestDatabase(): Database {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => Number(db.prepare(sql).run(...params).changes),
    all: <T,>(sql: string, params: readonly SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    transaction: (task) => {
      db.exec("BEGIN");
      try {
        task();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
