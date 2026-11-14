// core の LocalStore の SQLite の実装。画面の読み取りもここを通る。
// 読み取りは表ごとに配列をキャッシュし、変わるまで同じ配列を返す(useSyncExternalStore にそのまま渡せる)。
// 行ごとに保存先(dest)を持ち、スプレッドシートの行の変更だけを送信待ちに積む(docs/設計メモ.md の「保存先」)
import {
  changeId,
  rowId,
  type Category,
  type ForgottenItem,
  type HistoryCursor,
  type HistoryEntry,
  type Id,
  type Item,
  type LocalChange,
  type LocalStore,
  type MutableTable,
  type PendingOp,
  type RemoteApply,
  type RowOf,
  type ShoppingList,
  type Store,
  type StoreOrder,
  type SyncTable,
  type TableRows,
} from "@shopping-list/core";

import { type Database, migrate, type SqlValue } from "./db.ts";
import type { Destination } from "./destination.ts";

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
  columns: ["id", "name", "sort", "updated_at"],
  key: "id",
  orderBy: "sort, id",
  encode: (row: ShoppingList | Category) => [row.id, row.name, row.sort, row.updatedAt],
  decode: (row: Row) => ({
    id: row.id as Id,
    name: row.name as string,
    sort: row.sort as number,
    updatedAt: row.updated_at as string,
  }),
};

const TABLES: { [T in SyncTable]: TableDef<TableRows[T]> } = {
  lists: { ...namedSorted, name: "lists" },
  categories: {
    name: "categories",
    key: "id",
    columns: [...namedSorted.columns, "list_id"],
    orderBy: namedSorted.orderBy,
    // 属するリスト。版を上げる前の送信待ちの行には listId が無い
    encode: (row: Category) => [...namedSorted.encode(row), row.listId ?? null],
    decode: (row) => ({ ...namedSorted.decode(row), listId: row.list_id as Id | null }),
  },
  stores: {
    name: "stores",
    key: "id",
    columns: ["id", "name", "lat", "lng", "created_at", "updated_at", "list_id"],
    orderBy: "created_at, id",
    encode: (row: Store) => [row.id, row.name, row.lat, row.lng, row.createdAt, row.updatedAt, row.listId],
    decode: (row) => ({
      id: row.id as Id,
      name: row.name as string,
      lat: row.lat as number | null,
      lng: row.lng as number | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      listId: row.list_id as Id | null,
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
      "checked_updated_at",
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
      row.checkedUpdatedAt,
      row.updatedAt,
    ],
    decode: (row) => ({
      id: row.id as Id,
      listId: row.list_id as Id | null,
      name: row.name as string,
      categoryId: row.category_id as Id | null,
      categorySource: row.category_source as Item["categorySource"],
      memo: row.memo as string,
      checked: row.checked === 1,
      checkedAt: row.checked_at as string | null,
      checkedStoreId: row.checked_store_id as Id | null,
      checkedUpdatedAt: row.checked_updated_at as string,
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
  forgottenItems: {
    name: "forgotten_items",
    key: "id",
    columns: ["id", "list_id", "normalized_name", "forgotten_at", "updated_at"],
    orderBy: "forgotten_at, id",
    encode: (row: ForgottenItem) => [row.id, row.listId, row.normalizedName, row.forgottenAt, row.updatedAt],
    decode: (row) => ({
      id: row.id as Id,
      listId: row.list_id as Id,
      normalizedName: row.normalized_name as string,
      forgottenAt: row.forgotten_at as string,
      updatedAt: row.updated_at as string,
    }),
  },
  history: {
    name: "history",
    key: "id",
    columns: ["id", "list_id", "name", "category_id", "category_source", "store_id", "trip_id", "checked_at", "checked_seq"],
    orderBy: "checked_at, checked_seq, id",
    encode: (row: HistoryEntry) => [
      row.id,
      row.listId,
      row.name,
      row.categoryId,
      row.categorySource,
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
      categorySource: row.category_source as HistoryEntry["categorySource"],
      storeId: row.store_id as Id | null,
      tripId: row.trip_id as Id | null,
      checkedAt: row.checked_at as string,
      checkedSeq: row.checked_seq as number,
    }),
  },
};

const MUTABLE_TABLES: readonly MutableTable[] = ["lists", "categories", "stores", "items", "storeOrders", "forgottenItems"];
const ALL_TABLES: readonly SyncTable[] = [...MUTABLE_TABLES, "history"];

// 表の型の違いをここで消す。行の型は TABLES の組み合わせが保つ
function tableDef(table: SyncTable): TableDef<unknown> {
  return TABLES[table] as unknown as TableDef<unknown>;
}

// 値は columns の順の後ろに、保存先を足して渡す
function putSql(def: TableDef<unknown>, verb: "INSERT OR REPLACE" | "INSERT OR IGNORE"): string {
  const marks = def.columns.map(() => "?").join(", ");
  return `${verb} INTO ${def.name} (${def.columns.join(", ")}, dest) VALUES (${marks}, ?)`;
}

// リストに属する表。行の保存先はリストの保存先に合わせる
const LIST_CHILD_TABLES: ReadonlySet<SyncTable> = new Set(["categories", "stores", "items", "forgottenItems", "history"]);

function sameRow(a: object, b: object): boolean {
  const right = b as Record<string, unknown>;
  return Object.entries(a).every(([key, value]) => value === right[key]);
}

// 変わらなかった行は前のオブジェクトを使う。memo した行の部品を描き直さないため
function reuseRows(table: SyncTable, rows: unknown[], previous: unknown[]): unknown[] {
  const id = (row: unknown) => rowId({ table, row } as RowOf);
  const byId = new Map(previous.map((row) => [id(row), row as object]));
  return rows.map((row) => {
    const old = byId.get(id(row));
    return old && sameRow(old, row as object) ? old : row;
  });
}

export type StoreTopic = SyncTable | "pending" | "settings" | "writesLocked";

const HISTORY_CURSOR_KEY = "historyCursor";

export interface SqliteLocalStoreOptions {
  // false なら送信待ちを積まない(デモモード。送り先が無い)
  recordPending?: boolean;
  // 保存先を指定しない新しいリストと、親の無い新しい行(リストの決まっていない店舗など)の保存先。
  // スプレッドシートをつないでいれば sheets、いなければ local を返す。無ければ sheets
  defaultDest?: () => Destination;
  // 保存先を移すときの、シートの行を消す時刻。無ければ今
  now?: () => string;
}

export interface CommitOptions {
  // 変更の中のリストの保存先。新しいリストを作るときと、リストの保存先を移すときに渡す
  listDest?: Destination;
}

export class SqliteLocalStore implements LocalStore {
  readonly #db: Database;
  readonly #recordPending: boolean;
  readonly #defaultDest: () => Destination;
  readonly #now: () => string;
  #listDests: ReadonlyMap<Id, Destination> | null = null;
  readonly #rows = new Map<SyncTable, unknown[]>();
  // 変更で捨てた配列。次に読むときに、変わらなかった行を引き継ぐ
  readonly #staleRows = new Map<SyncTable, unknown[]>();
  #settings: Map<string, string> | null = null;
  #pendingCount: number | null = null;
  #writesLocked = false;
  readonly #listeners = new Map<StoreTopic, Set<() => void>>();

  constructor(db: Database, options: SqliteLocalStoreOptions = {}) {
    this.#db = db;
    this.#recordPending = options.recordPending ?? true;
    this.#defaultDest = options.defaultDest ?? (() => "sheets");
    this.#now = options.now ?? (() => new Date().toISOString());
    migrate(db);
  }

  // --- 画面の読み取り ---

  rows<T extends SyncTable>(table: T): readonly TableRows[T][] {
    const cached = this.#rows.get(table);
    if (cached) return cached as TableRows[T][];
    const def = tableDef(table);
    const decoded = this.#db.all<Row>(`SELECT * FROM ${def.name} ORDER BY ${def.orderBy}`).map((row) => def.decode(row));
    const stale = this.#staleRows.get(table);
    const rows = stale ? reuseRows(table, decoded, stale) : decoded;
    this.#staleRows.delete(table);
    this.#rows.set(table, rows);
    return rows as TableRows[T][];
  }

  // リストごとの保存先。リストの表が変わるまで同じ Map を返す
  listDestinations = (): ReadonlyMap<Id, Destination> => {
    this.#listDests ??= new Map(
      this.#db.all<{ id: Id; dest: Destination }>("SELECT id, dest FROM lists").map((row) => [row.id, row.dest]),
    );
    return this.#listDests;
  };

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
      else if (topic !== "writesLocked") {
        if (topic === "lists") this.#listDests = null;
        const cached = this.#rows.get(topic);
        if (cached) this.#staleRows.set(topic, cached);
        this.#rows.delete(topic);
      }
    }
    for (const topic of list) {
      for (const listener of this.#listeners.get(topic) ?? []) listener();
    }
  }

  // シートを替えるとき、ログアウトのときに、スプレッドシートの写しと送信待ちを消す。アプリ内の行は残す。
  // settings は消したあとに入れる設定で、同じトランザクションに入れる(シートが無い状態を画面に見せない)
  wipe(settings: Readonly<Record<string, string>> = {}): void {
    this.#db.transaction(() => {
      for (const table of ALL_TABLES) this.#db.run(`DELETE FROM ${TABLES[table].name} WHERE dest = 'sheets'`);
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

  writesLocked = (): boolean => this.#writesLocked;

  // task の間は書き込みを受け付けない(捨てる)。シートの切り替えの通信の間に足された変更が、
  // 確かめられないまま写しと一緒に消えないようにする。画面は止める表示を出す
  async whileWritesLocked<T>(task: () => Promise<T>): Promise<T> {
    this.#writesLocked = true;
    this.#notify(["writesLocked"]);
    try {
      return await task();
    } finally {
      this.#writesLocked = false;
      this.#notify(["writesLocked"]);
    }
  }

  // 同期で書く。画面は await せず、次の描画から新しい値が見える。
  // 行の保存先は親(リスト、手の順番は店舗)から決め、スプレッドシートの行の変更だけを送信待ちに積む。
  // 今の保存先と違えば移す。スプレッドシートへは行を足す操作を、アプリ内へはシートの行を消す操作を積む
  commitNow(changes: LocalChange[], options: CommitOptions = {}): void {
    if (changes.length === 0 || this.#writesLocked) return;
    let queued = false;
    this.#db.transaction(() => {
      const enqueue = (change: LocalChange) => {
        if (!this.#recordPending) return;
        this.#db.run("INSERT INTO pending_ops (table_name, row_id, change) VALUES (?, ?, ?)", [
          change.table,
          changeId(change),
          JSON.stringify(change),
        ]);
        queued = true;
      };
      for (const change of changes) {
        const def = tableDef(change.table);
        const id = changeId(change);
        const current = this.#destOf(def.name, def.key, id);
        if (change.action === "delete") {
          this.#db.run(`DELETE FROM ${def.name} WHERE ${def.key} = ?`, [id]);
          if ((current ?? this.#defaultDest()) === "sheets") enqueue(change);
          continue;
        }
        const dest = this.#destFor(change, current, options);
        this.#db.run(putSql(def, "INSERT OR REPLACE"), [...def.encode(change.row), dest]);
        if (dest === "sheets") enqueue(change);
        // History は足すだけで消せないので、シートに残す
        else if (current === "sheets" && change.table !== "history") {
          enqueue({ action: "delete", table: change.table, id, at: this.#now() });
        }
      }
    });
    const topics = new Set<StoreTopic>(changes.map((change) => change.table));
    if (queued) topics.add("pending");
    this.#notify(topics);
  }

  #destOf(table: string, key: string, id: Id): Destination | null {
    return this.#db.all<{ dest: Destination }>(`SELECT dest FROM ${table} WHERE ${key} = ?`, [id])[0]?.dest ?? null;
  }

  // 書く行の保存先。親があれば親の保存先、無ければ今の保存先、新しい行は既定の保存先。
  // 野良品目(リストの無い品目)は、リストへ移すまでアプリ内に置く
  #destFor(change: RowOf, current: Destination | null, options: CommitOptions): Destination {
    if (change.table === "lists") return options.listDest ?? current ?? this.#defaultDest();
    let parent: Destination | null = null;
    if (change.table === "storeOrders") {
      parent = this.#destOf("stores", "id", change.row.storeId);
    } else if (LIST_CHILD_TABLES.has(change.table)) {
      const { listId } = change.row as { listId?: Id | null };
      if (typeof listId === "string") parent = this.#destOf("lists", "id", listId);
      else if (change.table === "items") return current ?? "local";
    }
    return parent ?? current ?? this.#defaultDest();
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
        // アプリ内へ移したリストの履歴はシートに残っている。同じ ID なので、そのまま無視される
        if (this.#db.run(putSql(history, "INSERT OR IGNORE"), [...history.encode(entry), "sheets"]) > 0) changed.add("history");
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
    // 比べる相手はスプレッドシートの行だけ。シートに無いからといって、アプリ内の行を消さない
    const current = new Map<Id, unknown>();
    const local = new Set<Id>();
    for (const row of this.#db.all<Row>(`SELECT * FROM ${def.name}`)) {
      if (row.dest === "sheets") current.set(row[def.key] as Id, def.decode(row));
      else local.add(row[def.key] as Id);
    }
    const seen = new Set<Id>(input.keep[table] ?? []);
    let changed = false;
    for (const row of input.tables[table]) {
      const id = table === "storeOrders" ? (row as StoreOrder).storeId : (row as { id: Id }).id;
      seen.add(id);
      // アプリ内へ移した行が、まだシートに残っている(消す操作を送る前、相手の古い編集で生き返った)。
      // アプリ内の行を正とする
      if (local.has(id)) continue;
      if (isPending(id) || JSON.stringify(current.get(id)) === JSON.stringify(row)) continue;
      this.#db.run(putSql(def, "INSERT OR REPLACE"), [...def.encode(row), "sheets"]);
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
