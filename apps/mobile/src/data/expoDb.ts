// 端末の SQLite(expo-sqlite)。画面を非同期の読み込みで待たせないよう、同期の API だけを使う
import { openDatabaseSync } from "expo-sqlite";

import type { Database, SqlValue } from "./db.ts";

export function openDatabase(name: string): Database {
  const db = openDatabaseSync(name);
  // チェックの反応のために、書き込みの待ちを減らす(WAL なら NORMAL でも壊れない)
  db.execSync("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, params = []) => db.runSync(sql, params as SqlValue[]).changes,
    all: <T,>(sql: string, params: readonly SqlValue[] = []) => db.getAllSync<T>(sql, params as SqlValue[]),
    transaction: (task) => db.withTransactionSync(task),
  };
}
