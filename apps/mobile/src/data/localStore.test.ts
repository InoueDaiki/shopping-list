import {
  MemoryRemoteStore,
  SyncEngine,
  type HistoryEntry,
  type Item,
  type LocalChange,
  type RemoteApply,
  type ShoppingList,
} from "@shopping-list/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Database, migrate } from "./db.ts";
import { SqliteLocalStore } from "./localStore.ts";
import { openTestDatabase } from "./testDb.ts";

const AT = "2028-01-01T00:00:00.000Z";

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    listId: "list-1",
    name: "架空の品物",
    categoryId: null,
    categorySource: null,
    memo: "",
    checked: false,
    checkedAt: null,
    checkedStoreId: null,
    checkedUpdatedAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

const put = (row: Item): LocalChange => ({ action: "put", table: "items", row });

function emptyApply(overrides: Partial<RemoteApply> = {}): RemoteApply {
  return {
    tables: { lists: [], categories: [], stores: [], items: [], storeOrders: [], forgottenItems: [] },
    history: [],
    historyCursor: { position: 2, lastId: null },
    keep: {},
    ...overrides,
  };
}

// 版 6 で足した保存先の列を外す。前の版へ戻してから上げ直すテストで、列が重ならないようにする
function dropDest(db: Database): void {
  for (const table of ["lists", "categories", "stores", "items", "store_orders", "forgotten_items", "history"]) {
    const columns = db.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (columns.some((column) => column.name === "dest")) db.exec(`ALTER TABLE ${table} DROP COLUMN dest`);
  }
}

describe("migrate", () => {
  it("前の版の店舗に list_id を足し、行は null で残す", () => {
    const db = openTestDatabase();
    new SqliteLocalStore(db);
    dropDest(db);
    db.exec(`
      ALTER TABLE stores DROP COLUMN list_id;
      ALTER TABLE categories DROP COLUMN list_id;
      DROP TABLE forgotten_items;
      INSERT INTO stores VALUES ('store-1', '架空の店', 1.5, 2.5, '2028-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z');
      PRAGMA user_version = 2;
    `);
    const store = new SqliteLocalStore(db);
    expect(store.rows("stores")[0]).toMatchObject({ id: "store-1", lat: 1.5, listId: null });
  });

  it("前の版の写しに忘れた品目の表を足し、読み書きできる", () => {
    const db = openTestDatabase();
    new SqliteLocalStore(db);
    db.exec("DROP TABLE forgotten_items");
    db.exec("ALTER TABLE categories DROP COLUMN list_id");
    dropDest(db);
    db.exec("PRAGMA user_version = 3");
    const store = new SqliteLocalStore(db);
    expect(store.rows("forgottenItems")).toEqual([]);
    const row = { id: "forget-1", listId: "list-1", normalizedName: "ぎゅうにゅう", forgottenAt: "2028-01-02T00:00:00.000Z", updatedAt: "2028-01-02T00:00:00.000Z" };
    store.commitNow([{ action: "put", table: "forgottenItems", row }]);
    expect(store.rows("forgottenItems")).toEqual([row]);
  });
});

describe("migrate の版 5", () => {
  it("品目の list_id を空にできるようにし、前の行と並びを残す", () => {
    const db = openTestDatabase();
    new SqliteLocalStore(db);
    db.exec(`
      ALTER TABLE categories DROP COLUMN list_id;
      DROP TABLE items;
      CREATE TABLE items (
        id TEXT PRIMARY KEY, list_id TEXT NOT NULL, name TEXT NOT NULL,
        category_id TEXT, category_source TEXT, memo TEXT NOT NULL,
        checked INTEGER NOT NULL, checked_at TEXT, checked_store_id TEXT, updated_at TEXT NOT NULL,
        checked_updated_at TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO items VALUES ('item-b', 'list-1', '架空の品物B', NULL, NULL, 'メモ', 1, '${AT}', 'store-1', '${AT}', '${AT}');
      INSERT INTO items VALUES ('item-a', 'list-1', '架空の品物A', NULL, NULL, '', 0, NULL, NULL, '${AT}', '${AT}');
      PRAGMA user_version = 4;
    `);
    dropDest(db);
    const store = new SqliteLocalStore(db, { recordPending: false });
    expect(store.rows("items").map((row) => [row.id, row.listId, row.checked, row.memo])).toEqual([
      ["item-b", "list-1", true, "メモ"],
      ["item-a", "list-1", false, ""],
    ]);
    store.commitNow([put(item({ id: "stray", listId: null }))]);
    expect(store.rows("items").at(-1)).toEqual(item({ id: "stray", listId: null }));
  });
});

describe("migrate の版 7", () => {
  it("カテゴリに list_id を足し、前の行は共通のカテゴリ(null)として読む", () => {
    const db = openTestDatabase();
    new SqliteLocalStore(db);
    dropDest(db);
    db.exec(`
      ALTER TABLE categories DROP COLUMN list_id;
      INSERT INTO categories VALUES ('cat-b', '架空の売り場B', 2, '${AT}');
      INSERT INTO categories VALUES ('cat-a', '架空の売り場A', 1, '${AT}');
      PRAGMA user_version = 5;
    `);
    const store = new SqliteLocalStore(db, { recordPending: false });
    expect(store.rows("categories")).toEqual([
      { id: "cat-a", name: "架空の売り場A", sort: 1, updatedAt: AT, listId: null },
      { id: "cat-b", name: "架空の売り場B", sort: 2, updatedAt: AT, listId: null },
    ]);
    const own = { id: "cat-a-list-1", name: "架空の売り場A", sort: 1, updatedAt: AT, listId: "list-1" };
    store.commitNow([{ action: "put", table: "categories", row: own }]);
    expect(store.rows("categories").find((row) => row.id === own.id)).toEqual(own);
    // リストは今までどおり(list_id の列を持たない)
    store.commitNow([{ action: "put", table: "lists", row: { id: "list-1", name: "架空のリスト", sort: 1, updatedAt: AT } }]);
    expect(store.rows("lists")).toEqual([{ id: "list-1", name: "架空のリスト", sort: 1, updatedAt: AT }]);
  });
});

describe("SqliteLocalStore", () => {
  let store: SqliteLocalStore;

  beforeEach(() => {
    store = new SqliteLocalStore(openTestDatabase());
  });

  it("切り替えの間の書き込みは受け付けず、終われば受け付ける", async () => {
    const seen: boolean[] = [];
    store.subscribe("writesLocked", () => seen.push(store.writesLocked()));
    await store.whileWritesLocked(async () => {
      store.commitNow([put(item({ id: "dropped" }))]);
    });
    expect(store.rows("items")).toEqual([]);
    expect(store.pendingCountNow()).toBe(0);
    expect(seen).toEqual([true, false]);

    store.commitNow([put(item({ id: "kept" }))]);
    expect(store.rows("items")).toHaveLength(1);
  });

  it("切り替えに失敗しても、書き込みの受け付けに戻る", async () => {
    await expect(
      store.whileWritesLocked(async () => {
        throw new Error("通信できない");
      }),
    ).rejects.toThrow();
    expect(store.writesLocked()).toBe(false);
  });

  it("古い版の写しの品目に checked_updated_at を足す", () => {
    const db = openTestDatabase();
    const old = new SqliteLocalStore(db);
    old.commitNow([put(item())]);
    db.exec("ALTER TABLE items DROP COLUMN checked_updated_at");
    db.exec("ALTER TABLE stores DROP COLUMN list_id");
    db.exec("ALTER TABLE categories DROP COLUMN list_id");
    db.exec("DROP TABLE forgotten_items");
    dropDest(db);
    db.exec("PRAGMA user_version = 1");

    expect(new SqliteLocalStore(db).rows("items")[0]?.checkedUpdatedAt).toBe(AT);
  });

  it("変わらなかった行は同じオブジェクトのまま返す", () => {
    store.commitNow([put(item({ id: "a" })), put(item({ id: "b" }))]);
    const [a, b] = store.rows("items");
    store.commitNow([put(item({ id: "b", checked: true }))]);
    const rows = store.rows("items");
    expect(rows.find((row) => row.id === "a")).toBe(a);
    expect(rows.find((row) => row.id === "b")).not.toBe(b);
    expect(rows.find((row) => row.id === "b")?.checked).toBe(true);
  });

  it("行を型のとおりに読み書きする", () => {
    const row = item({ checked: true, checkedAt: AT, categorySource: "user", categoryId: "cat-1", memo: "メモ" });
    store.commitNow([
      put(row),
      { action: "put", table: "storeOrders", row: { storeId: "store-1", categoryIds: ["a", "b"], editedAt: AT } },
      { action: "put", table: "stores", row: { id: "store-1", name: "架空の店", lat: 1.5, lng: null, createdAt: AT, updatedAt: AT, listId: "list-1" } },
    ]);
    expect(store.rows("items")).toEqual([row]);
    expect(store.rows("storeOrders")[0]?.categoryIds).toEqual(["a", "b"]);
    expect(store.rows("stores")[0]).toMatchObject({ lat: 1.5, listId: "list-1" });
  });

  it("変わるまで同じ配列を返し、変わった表だけ通知する", () => {
    const items = vi.fn();
    const lists = vi.fn();
    store.subscribe("items", items);
    store.subscribe("lists", lists);
    const before = store.rows("items");
    expect(store.rows("items")).toBe(before);
    store.commitNow([put(item())]);
    expect(items).toHaveBeenCalledTimes(1);
    expect(lists).not.toHaveBeenCalled();
    expect(store.rows("items")).not.toBe(before);
  });

  it("送信待ちを順に積み、指定の seq だけ消す", async () => {
    store.commitNow([put(item({ id: "a" })), put(item({ id: "b" }))]);
    const ops = await store.pendingOps(10);
    expect(ops.map((op) => (op.action === "put" && op.table === "items" ? op.row.id : ""))).toEqual(["a", "b"]);
    await store.ackOps([ops[0]?.seq ?? 0]);
    expect(store.pendingCountNow()).toBe(1);
  });

  it("送信待ちを積まない設定では数が増えない", () => {
    const demo = new SqliteLocalStore(openTestDatabase(), { recordPending: false });
    demo.commitNow([put(item())]);
    expect(demo.pendingCountNow()).toBe(0);
    expect(demo.rows("items")).toHaveLength(1);
  });

  it("applyRemote は送信待ちの行を変えず、無い行を消す", async () => {
    store.commitNow([put(item({ id: "pending", name: "手元" })), put(item({ id: "gone" }))]);
    await store.ackOps((await store.pendingOps(10)).filter((op) => op.action === "put" && op.table === "items" && op.row.id === "gone").map((op) => op.seq));
    await store.applyRemote(
      emptyApply({
        tables: {
          lists: [],
          categories: [],
          stores: [],
          storeOrders: [],
          forgottenItems: [],
          items: [item({ id: "pending", name: "シート" }), item({ id: "new" })],
        },
      }),
    );
    expect(store.rows("items").map((row) => [row.id, row.name])).toEqual([
      ["pending", "手元"],
      ["new", "架空の品物"],
    ]);
  });

  it("applyRemote は keep の行を消さず、History を ID で重ね、位置を保存する", async () => {
    store.commitNow([put(item({ id: "broken" }))]);
    await store.ackOps((await store.pendingOps(10)).map((op) => op.seq));
    const entry = {
      id: "h-1",
      listId: "list-1",
      name: "架空の品物",
      categoryId: null,
      categorySource: null,
      storeId: null,
      tripId: null,
      checkedAt: AT,
      checkedSeq: 0,
    };
    const input = emptyApply({ keep: { items: ["broken"] }, history: [entry, entry], historyCursor: { position: 3, lastId: "h-1" } });
    await store.applyRemote(input);
    await store.applyRemote(input);
    expect(store.rows("items")).toHaveLength(1);
    expect(store.rows("history")).toEqual([entry]);
    expect(await store.historyCursor()).toEqual({ position: 3, lastId: "h-1" });
  });

  it("同じ内容の取り込みでは描き直しの通知を出さない", async () => {
    const row = item();
    store.commitNow([put(row)]);
    await store.ackOps((await store.pendingOps(10)).map((op) => op.seq));
    const listener = vi.fn();
    store.subscribe("items", listener);
    await store.applyRemote(emptyApply({ tables: { lists: [], categories: [], stores: [], storeOrders: [], forgottenItems: [], items: [row] } }));
    expect(listener).not.toHaveBeenCalled();
  });

  it("wipe は全部を消し、渡した設定だけを残す", async () => {
    store.commitNow([put(item())]);
    store.setSetting("old", "1");
    store.wipe({ spreadsheet: "next" });
    expect(store.rows("items")).toEqual([]);
    expect(store.pendingCountNow()).toBe(0);
    expect(store.setting("old")).toBeNull();
    expect(store.setting("spreadsheet")).toBe("next");
    expect(await store.historyCursor()).toBeNull();
  });

  it("wipe はアプリ内の行を残す", () => {
    store.commitNow([{ action: "put", table: "lists", row: LOCAL_LIST }], { listDest: "local" });
    store.commitNow([put(item({ id: "kept", listId: LOCAL_LIST.id })), put(item({ id: "gone" }))]);
    store.wipe();
    expect(store.rows("lists")).toEqual([LOCAL_LIST]);
    expect(store.rows("items").map((row) => row.id)).toEqual(["kept"]);
    expect(store.listDestinations().get(LOCAL_LIST.id)).toBe("local");
  });

  it("マイグレーションは何度動かしても同じ", () => {
    const db = openTestDatabase();
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
  });

  it("SyncEngine と一緒に、送ってから写す", async () => {
    const remote = new MemoryRemoteStore();
    const engine = new SyncEngine({ local: store, remote });
    store.commitNow([put(item())]);
    const result = await engine.sync();
    expect(result.status).toBe("ok");
    expect(result.pending).toBe(0);
    expect(remote.rows.items).toHaveLength(1);
    expect(store.rows("items")).toHaveLength(1);
  });
});

const LOCAL_LIST: ShoppingList = { id: "list-local", name: "架空のリスト", sort: 1, updatedAt: AT };
const SHEET_LIST: ShoppingList = { id: "list-sheet", name: "架空の共有リスト", sort: 2, updatedAt: AT };

describe("保存先", () => {
  let store: SqliteLocalStore;
  const LATER = "2028-01-02T00:00:00.000Z";
  const pendingChanges = async () => (await store.pendingOps(100)).map(({ seq: _seq, ...change }) => change);

  beforeEach(() => {
    store = new SqliteLocalStore(openTestDatabase(), { now: () => LATER });
    store.commitNow([{ action: "put", table: "lists", row: LOCAL_LIST }], { listDest: "local" });
    store.commitNow([{ action: "put", table: "lists", row: SHEET_LIST }], { listDest: "sheets" });
  });

  it("アプリ内のリストと、その行の変更は送信待ちに積まない", async () => {
    store.commitNow([put(item({ listId: LOCAL_LIST.id }))]);
    store.commitNow([{ action: "delete", table: "items", id: "item-1", at: LATER }]);
    expect(await pendingChanges()).toEqual([{ action: "put", table: "lists", row: SHEET_LIST }]);
    expect(store.listDestinations()).toEqual(new Map([[LOCAL_LIST.id, "local"], [SHEET_LIST.id, "sheets"]]));
  });

  it("リストを書き直しても保存先を保つ", async () => {
    store.commitNow([{ action: "put", table: "lists", row: { ...LOCAL_LIST, name: "名前を変えた" } }]);
    expect(store.listDestinations().get(LOCAL_LIST.id)).toBe("local");
    expect(await store.pendingCount()).toBe(1);
  });

  it("手の順番は店舗の保存先に置く", async () => {
    const shop = { id: "store-1", name: "架空の店", lat: null, lng: null, createdAt: AT, updatedAt: AT, listId: LOCAL_LIST.id };
    store.commitNow([
      { action: "put", table: "stores", row: shop },
      { action: "put", table: "storeOrders", row: { storeId: shop.id, categoryIds: ["cat-1"], editedAt: AT } },
    ]);
    expect(await store.pendingCount()).toBe(1);
  });

  it("保存先を指定しない新しいリストは既定の保存先に置き、書き直しても保つ", async () => {
    let dest: "local" | "sheets" = "local";
    const own = new SqliteLocalStore(openTestDatabase(), { defaultDest: () => dest });
    own.commitNow([{ action: "put", table: "lists", row: LOCAL_LIST }]);
    dest = "sheets";
    own.commitNow([{ action: "put", table: "lists", row: { ...LOCAL_LIST, name: "名前を変えた" } }]);
    expect(await own.pendingCount()).toBe(0);
    own.commitNow([{ action: "put", table: "lists", row: SHEET_LIST }]);
    expect(await own.pendingCount()).toBe(1);
  });

  it("野良品目は、スプレッドシートをつないでいてもアプリ内に置く", async () => {
    const before = await store.pendingCount();
    store.commitNow([put(item({ id: "stray", listId: null }))]);
    store.commitNow([{ action: "delete", table: "items", id: "stray", at: LATER }]);
    expect(await store.pendingCount()).toBe(before);
  });

  it("前の版がシートに置いた野良品目は、消すとシートからも消す", async () => {
    await store.applyRemote(emptyApply({
      tables: { ...emptyApply().tables, lists: [SHEET_LIST], items: [item({ id: "stray", listId: null })] },
    }));
    store.commitNow([{ action: "delete", table: "items", id: "stray", at: LATER }]);
    expect((await pendingChanges()).at(-1)).toEqual({ action: "delete", table: "items", id: "stray", at: LATER });
  });

  it("アプリ内の行をスプレッドシートのリストへ移すと、行を足す操作を積む", async () => {
    const stray = item({ id: "stray", listId: LOCAL_LIST.id });
    store.commitNow([put(stray)]);
    store.commitNow([put({ ...stray, listId: SHEET_LIST.id })]);
    expect((await pendingChanges()).at(-1)).toEqual(put({ ...stray, listId: SHEET_LIST.id }));
  });

  it("スプレッドシートの行をアプリ内のリストへ移すと、端末の行を残してシートの行を消す操作を積む", async () => {
    const shared = item({ listId: SHEET_LIST.id });
    store.commitNow([put(shared)]);
    store.commitNow([put({ ...shared, listId: LOCAL_LIST.id })]);
    expect(store.rows("items")).toEqual([{ ...shared, listId: LOCAL_LIST.id }]);
    expect((await pendingChanges()).at(-1)).toEqual({ action: "delete", table: "items", id: shared.id, at: LATER });
  });

  it("History はアプリ内へ移しても、シートの行を消す操作を積まない", async () => {
    const entry: HistoryEntry = {
      id: "history-1", listId: SHEET_LIST.id, name: "架空の品物", categoryId: null, categorySource: null,
      storeId: null, tripId: null, checkedAt: AT, checkedSeq: 0,
    };
    store.commitNow([{ action: "put", table: "history", row: entry }]);
    const before = await store.pendingCount();
    store.commitNow([
      { action: "put", table: "lists", row: SHEET_LIST },
      { action: "put", table: "history", row: entry },
    ], { listDest: "local" });
    expect(store.rows("history")).toEqual([entry]);
    // 増えるのは、リストの行を消す操作だけ
    expect(await store.pendingCount()).toBe(before + 1);
  });

  it("applyRemote はアプリ内の行を消さず、同じ ID のシートの行で上書きしない", async () => {
    const mine = item({ id: "mine", listId: LOCAL_LIST.id, memo: "端末の値" });
    store.commitNow([put(mine)]);
    await store.ackOps((await store.pendingOps(100)).map((op) => op.seq));
    await store.applyRemote(emptyApply({
      tables: { ...emptyApply().tables, lists: [SHEET_LIST], items: [{ ...mine, memo: "シートの値" }, item({ id: "theirs", listId: SHEET_LIST.id })] },
    }));
    expect(store.rows("lists")).toEqual([LOCAL_LIST, SHEET_LIST]);
    expect(store.rows("items")).toEqual([mine, item({ id: "theirs", listId: SHEET_LIST.id })]);
    // シートから消えた行は、スプレッドシートの行だけを消す
    await store.applyRemote(emptyApply());
    expect(store.rows("lists")).toEqual([LOCAL_LIST]);
    expect(store.rows("items")).toEqual([mine]);
  });

  it("前の版の写しは、すべてスプレッドシートの行として上げる", () => {
    const db = openTestDatabase();
    new SqliteLocalStore(db).commitNow([{ action: "put", table: "lists", row: SHEET_LIST }]);
    dropDest(db);
    db.exec("ALTER TABLE categories DROP COLUMN list_id");
    db.exec("PRAGMA user_version = 5");
    expect(new SqliteLocalStore(db).listDestinations().get(SHEET_LIST.id)).toBe("sheets");
  });
});
