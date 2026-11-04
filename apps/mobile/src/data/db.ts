// 端末の SQLite の、使う分だけの形。画面は同期で読むので、すべて同期の API にする。
// 実体は expoDb.ts(端末)と testDb.ts(テスト。Node の node:sqlite)

export type SqlValue = string | number | null;

export interface Database {
  exec(sql: string): void;
  // 変えた行の数を返す
  run(sql: string, params?: readonly SqlValue[]): number;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  // 途中で投げたら全部を取り消す
  transaction(task: () => void): void;
}

interface Migration {
  version: number;
  sql: string;
}

// スキーマはアプリの中で管理する。変えるときは、版を足して後ろへ追加する(前の版の SQL は書き換えない)
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE lists (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, sort REAL NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE categories (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, sort REAL NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE stores (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL, lng REAL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE items (
        id TEXT PRIMARY KEY, list_id TEXT NOT NULL, name TEXT NOT NULL,
        category_id TEXT, category_source TEXT, memo TEXT NOT NULL,
        checked INTEGER NOT NULL, checked_at TEXT, checked_store_id TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE store_orders (
        store_id TEXT PRIMARY KEY, category_ids TEXT NOT NULL, edited_at TEXT NOT NULL
      );
      CREATE TABLE history (
        id TEXT PRIMARY KEY, list_id TEXT NOT NULL, name TEXT NOT NULL,
        category_id TEXT, category_source TEXT, store_id TEXT, trip_id TEXT,
        checked_at TEXT NOT NULL, checked_seq INTEGER NOT NULL
      );
      CREATE TABLE pending_ops (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL, row_id TEXT NOT NULL, change TEXT NOT NULL
      );
      CREATE INDEX pending_ops_row ON pending_ops (table_name, row_id);
      -- 端末だけの設定(シートの ID、History の読み終えた位置、買い物の状態)。シートへ送らない
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE items ADD COLUMN checked_updated_at TEXT NOT NULL DEFAULT '';
      UPDATE items SET checked_updated_at = updated_at;
    `,
  },
  {
    version: 3,
    sql: `ALTER TABLE stores ADD COLUMN list_id TEXT;`,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE forgotten_items (
        id TEXT PRIMARY KEY, list_id TEXT NOT NULL, normalized_name TEXT NOT NULL,
        forgotten_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `,
  },
  {
    // items の list_id を空にできるようにする(野良品目)。SQLite は列の NOT NULL を外せないので作り直す。
    // 行の順(rowid)は一覧の並びに使うので、そのまま写す
    version: 5,
    sql: `
      CREATE TABLE items_next (
        id TEXT PRIMARY KEY, list_id TEXT, name TEXT NOT NULL,
        category_id TEXT, category_source TEXT, memo TEXT NOT NULL,
        checked INTEGER NOT NULL, checked_at TEXT, checked_store_id TEXT, updated_at TEXT NOT NULL,
        checked_updated_at TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO items_next (rowid, id, list_id, name, category_id, category_source, memo, checked, checked_at, checked_store_id, updated_at, checked_updated_at)
        SELECT rowid, id, list_id, name, category_id, category_source, memo, checked, checked_at, checked_store_id, updated_at, checked_updated_at FROM items;
      DROP TABLE items;
      ALTER TABLE items_next RENAME TO items;
    `,
  },
];

export function migrate(db: Database): void {
  const [row] = db.all<{ user_version: number }>("PRAGMA user_version");
  const current = row?.user_version ?? 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
}
