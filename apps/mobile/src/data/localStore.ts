// core の LocalStore の SQLite の実装。画面の読み取りもここを通る。
// 読み取りは表ごとに配列をキャッシュし、変わるまで同じ配列を返す(useSyncExternalStore にそのまま渡せる)
import {
  changeId,
  type Category,
  type HistoryCursor,
  type HistoryEntry,
  type Id,
  type Item,
  type LocalChange,
  type LocalStore,
  type MutableTable,
  type PendingOp,
  type RemoteApply,
  type ShoppingList,
  type Store,
  type StoreOrder,
  type SyncTable,
  type TableRows,
} from "@shopping-list/core";

import { type Database, migrate, type SqlValue } from "./db.ts";

type Row = Record<string, SqlValue>;

interface TableDef<T> {
  name: string;
  key: string;
  columns: string[];
  // 1行を、columns の順の値にする
  encode(row: T): SqlValue[];
  decode(row: Row): T;
  // 読むときの順
  orderBy: string;
}

const namedSorted = {
  columns: ["id", "name", "sort"],
  key: "id",
  orderBy: "sort, id",
  encode: (row: ShoppingList | Category) => [row.id, row.name, row.sort],
  decode: (row: Row) => ({ id: row.id as Id, name: row.name as string, sort: row.sort as number }),
};

const TABLES: { [T in SyncTable]: TableDef<TableRows[T]> } = {
  lists: { ...namedSorted, name: "lists" },
  categories: { ...namedSorted, name: "categories" },
  stores: {
    name: "stores",
    key: "id",
    columns: ["id", "name", "lat", "lng", "created_at"],
    orderBy: "created_at, id",
    encode: (row: Store) => [row.id, row.name, row.lat, row.lng, row.createdAt],
    decode: (row) => ({
      id: row.id as Id,
      name: row.name as string,
      lat: row.lat as number | null,
      lng: row.lng as number | null,
      createdAt: row.created_at as string,
    }),
  },
  items: {
    name: "items",
    key: "id",
    columns: [
      "id",
      "list_id",
      "name",
      "category_id",
      "category_source",
      "memo",
      "checked",
      "checked_at",
      "checked_store_id",
      "updated_at",
    ],
    orderBy: "rowid",
    encode: (row: Item) => [
      row.id,
      row.listId,
      row.name,
      row.categoryId,
      row.categorySource,
      row.memo,
      row.checked ? 1 : 0,
      row.checkedAt,
      row.checkedStoreId,
      row.updatedAt,
    ],
    decode: (row) => ({
      id: row.id as Id,
      listId: row.list_id as Id,
      name: row.name as string,
      categoryId: row.category_id as Id | null,
      categorySource: row.category_source as Item["categorySource"],
      memo: row.memo as string,
      checked: row.checked === 1,
      checkedAt: row.checked_at as string | null,
      checkedStoreId: row.checked_store_id as Id | null,
      updatedAt: row.updated_at as string,
    }),
  },
  storeOrders: {
    name: "store_orders",
    key: "store_id",
    columns: ["store_id", "category_ids", "edited_at"],
    orderBy: "store_id",
    encode: (row: StoreOrder) => [row.storeId, row.categoryIds.join(","), row.editedAt],
    decode: (row) => ({
      storeId: row.store_id as Id,
      categoryIds: row.category_ids === "" ? [] : (row.category_ids as string).split(","),
      editedAt: row.edited_at as string,
    }),
  },
  history: {
    name: "history",
    key: "id",
    columns: ["id", "list_id", "name", "category_id", "store_id", "trip_id", "checked_at", "checked_seq"],
    orderBy: "checked_at, checked_seq, id",
    encode: (row: HistoryEntry) => [
      row.id,
      row.listId,
      row.name,
      row.categoryId,
      row.storeId,
      row.tripId,
      row.checkedAt,
      row.checkedSeq,
    ],
    decode: (row) => ({
      id: row.id as Id,
      listId: row.list_id as Id,
      name: row.name as string,
      categoryId: row.category_id as Id | null,
      storeId: row.store_id as Id | null,
      tripId: row.trip_id as Id | null,
      checkedAt: row.checked_at as string,
      checkedSeq: row.checked_seq as number,
    }),
  },
};

const MUTABLE_TABLES: readonly MutableTable[] = ["lists", "categories", "stores", "items", "storeOrders"];
const ALL_TABLES: readonly SyncTable[] = [...MUTABLE_TABLES, "history"];

// 表の型の違いをここで消す。行の型は TABLES の組み合わせが保つ
function tableDef(table: SyncTable): TableDef<unknown> {
  return TABLES[table] as unknown as TableDef<unknown>;
}

function putSql(def: TableDef<unknown>, verb: "INSERT OR REPLACE" | "INSERT OR IGNORE"): string {
  const marks = def.columns.map(() => "?").join(", ");
  return `${verb} INTO ${def.name} (${def.columns.join(", ")}) VALUES (${marks})`;
}

export type StoreTopic = SyncTable | "pending" | "settings";

const HISTORY_CURSOR_KEY = "historyCursor";

export interface SqliteLocalStoreOptions {
  // false なら送信待ちを積まない(デモモード。送り先が無い)
  recordPending?: boolean;
}

export class SqliteLocalStore implements LocalStore {
  readonly #db: Database;
  readonly #recordPending: boolean;
  readonly #rows = new Map<SyncTable, unknown[]>();
  #settings: Map<string, string> | null = null;
  #pendingCount: number | null = null;
  readonly #listeners = new Map<StoreTopic, Set<() => void>>();

  constructor(db: Database, options: SqliteLocalStoreOptions = {}) {
    this.#db = db;
    this.#recordPending = options.recordPending ?? true;
    migrate(db);
  }

  // --- 画面の読み取り ---

  rows<T extends SyncTable>(table: T): readonly TableRows[T][] {
    const cached = this.#rows.get(table);
    if (cached) return cached as TableRows[T][];
    const def = tableDef(table);
    const rows = this.#db.all<Row>(`SELECT * FROM ${def.name} ORDER BY ${def.orderBy}`).map((row) => def.decode(row));
    this.#rows.set(table, rows);
    return rows as TableRows[T][];
  }

  pendingCountNow(): number {
    this.#pendingCount ??= this.#db.all<{ n: number }>("SELECT COUNT(*) AS n FROM pending_ops")[0]?.n ?? 0;
    return this.#pendingCount;
  }

  setting(key: string): string | null {
    if (!this.#settings) {
      const rows = this.#db.all<{ key: string; value: string }>("SELECT key, value FROM settings");
      this.#settings = new Map(rows.map((row) => [row.key, row.value]));
    }
    return this.#settings.get(key) ?? null;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) {
      this.#db.run("DELETE FROM settings WHERE key = ?", [key]);
    } else {
      this.#db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
    }
    this.#notify(["settings"]);
  }

  subscribe = (topic: StoreTopic, listener: () => void): (() => void) => {
    const listeners = this.#listeners.get(topic) ?? new Set();
    this.#listeners.set(topic, listeners);
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  #notify(topics: Iterable<StoreTopic>): void {
    const list = [...topics];
    for (const topic of list) {
      if (topic === "pending") this.#pendingCount = null;
      else if (topic === "settings") this.#settings = null;
      else this.#rows.delete(topic);
    }
    for (const topic of list) {
      for (const listener of this.#listeners.get(topic) ?? []) listener();
    }
  }

  // シートを替えるとき、ログアウトのときに全部を消す。settings は消したあとに入れる設定で、
  // 同じトランザクションに入れる(シートが無い状態を画面に見せない)
  wipe(settings: Readonly<Record<string, string>> = {}): void {
    this.#db.transaction(() => {
      for (const table of ALL_TABLES) this.#db.run(`DELETE FROM ${TABLES[table].name}`);
      this.#db.run("DELETE FROM pending_ops");
      this.#db.run("DELETE FROM settings");
      for (const [key, value] of Object.entries(settings)) {
        this.#db.run("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
      }
    });
    this.#notify([...ALL_TABLES, "pending", "settings"]);
  }

  // --- LocalStore ---

  commit(changes: LocalChange[]): Promise<void> {
    this.commitNow(changes);
    return Promise.resolve();
  }

  // 同期で書く。画面は await せず、次の描画から新しい値が見える
  commitNow(changes: LocalChange[]): void {
    if (changes.length === 0) return;
    this.#db.transaction(() => {
      for (const change of changes) {
        const def = tableDef(change.table);
        if (change.action === "put") {
          this.#db.run(putSql(def, "INSERT OR REPLACE"), def.encode(change.row));
        } else {
          this.#db.run(`DELETE FROM ${def.name} WHERE ${def.key} = ?`, [change.id]);
        }
        if (this.#recordPending) {
          this.#db.run("INSERT INTO pending_ops (table_name, row_id, change) VALUES (?, ?, ?)", [
            change.table,
            changeId(change),
            JSON.stringify(change),
          ]);
        }
      }
    });
    const topics = new Set<StoreTopic>(changes.map((change) => change.table));
    if (this.#recordPending) topics.add("pending");
    this.#notify(topics);
  }

  pendingOps(limit: number): Promise<PendingOp[]> {
    const rows = this.#db.all<{ seq: number; change: string }>(
      "SELECT seq, change FROM pending_ops ORDER BY seq LIMIT ?",
      [limit],
    );
    return Promise.resolve(rows.map(({ seq, change }) => ({ ...(JSON.parse(change) as LocalChange), seq })));
  }

  pendingCount(): Promise<number> {
    return Promise.resolve(this.pendingCountNow());
  }

  ackOps(seqs: number[]): Promise<void> {
    if (seqs.length > 0) {
      this.#db.transaction(() => {
        for (const seq of seqs) this.#db.run("DELETE FROM pending_ops WHERE seq = ?", [seq]);
      });
      this.#notify(["pending"]);
    }
    return Promise.resolve();
  }

  historyCursor(): Promise<HistoryCursor | null> {
    const stored = this.setting(HISTORY_CURSOR_KEY);
    return Promise.resolve(stored === null ? null : (JSON.parse(stored) as HistoryCursor));
  }

  applyRemote(input: RemoteApply): Promise<void> {
    const changed = new Set<StoreTopic>();
    this.#db.transaction(() => {
      const pending = new Set(
        this.#db
          .all<{ table_name: string; row_id: string }>("SELECT table_name, row_id FROM pending_ops")
          .map((op) => `${op.table_name}\0${op.row_id}`),
      );
      for (const table of MUTABLE_TABLES) {
        if (this.#applyTable(table, input, pending)) changed.add(table);
      }
      const history = tableDef("history");
      for (const entry of input.history) {
        // 足すだけの表なので、同じ ID は同じ内容。2台が同じトリップを移しても ID で重なる
        if (this.#db.run(putSql(history, "INSERT OR IGNORE"), history.encode(entry)) > 0) changed.add("history");
      }
      this.#db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
        HISTORY_CURSOR_KEY,
        JSON.stringify(input.historyCursor),
      ]);
    });
    // 変わらなかった表は配列を保つ。30秒ごとの同期で画面を描き直さない
    this.#notify(changed);
    this.#settings = null;
    return Promise.resolve();
  }

  #applyTable(table: MutableTable, input: RemoteApply, pending: ReadonlySet<string>): boolean {
    const def = tableDef(table);
    const isPending = (id: Id) => pending.has(`${table}\0${id}`);
    const current = new Map(
      this.#db.all<Row>(`SELECT * FROM ${def.name}`).map((row) => [row[def.key] as Id, def.decode(row)]),
    );
    const seen = new Set<Id>(input.keep[table] ?? []);
    let changed = false;
    for (const row of input.tables[table]) {
      const id = table === "storeOrders" ? (row as StoreOrder).storeId : (row as { id: Id }).id;
      seen.add(id);
      if (isPending(id) || JSON.stringify(current.get(id)) === JSON.stringify(row)) continue;
      this.#db.run(putSql(def, "INSERT OR REPLACE"), def.encode(row));
      changed = true;
    }
    for (const id of current.keys()) {
      if (seen.has(id) || isPending(id)) continue;
      this.#db.run(`DELETE FROM ${def.name} WHERE ${def.key} = ?`, [id]);
      changed = true;
    }
    return changed;
  }
}
