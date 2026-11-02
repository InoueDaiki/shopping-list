import { MemoryRemoteStore, SyncEngine, type Item, type LocalChange, type RemoteApply } from "@shopping-list/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { migrate } from "./db.ts";
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
    tables: { lists: [], categories: [], stores: [], items: [], storeOrders: [] },
    history: [],
    historyCursor: { position: 2, lastId: null },
    keep: {},
    ...overrides,
  };
}

describe("migrate", () => {
  it("前の版の店舗に list_id を足し、行は null で残す", () => {
    const db = openTestDatabase();
    db.exec(`
      CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL, lng REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO stores VALUES ('store-1', '架空の店', 1.5, 2.5, '2028-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z');
      PRAGMA user_version = 2;
    `);
    const store = new SqliteLocalStore(db);
    expect(store.rows("stores")[0]).toMatchObject({ id: "store-1", lat: 1.5, listId: null });
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
    await store.applyRemote(emptyApply({ tables: { lists: [], categories: [], stores: [], storeOrders: [], items: [row] } }));
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
