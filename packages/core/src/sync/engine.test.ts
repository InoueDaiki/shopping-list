import { describe, expect, it } from "vitest";

import type { HistoryEntry, Item, StoreOrder } from "../types.ts";
import { SyncEngine } from "./engine.ts";
import { MemoryLocalStore, MemoryRemoteStore } from "./memory.ts";
import { coalesceOps, planPush } from "./plan.ts";
import type { PendingOp } from "./types.ts";

const T = (minute: number) => `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`;

function item(id: string, updatedAt: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    listId: "list1",
    name: "とうふ",
    categoryId: null,
    categorySource: null,
    memo: "",
    checked: false,
    checkedAt: null,
    checkedStoreId: null,
    updatedAt,
    ...overrides,
  };
}

function history(id: string): HistoryEntry {
  return {
    id,
    listId: "list1",
    name: "牛乳",
    categoryId: null,
    storeId: null,
    tripId: null,
    checkedAt: T(0),
    checkedSeq: 1,
  };
}

function device(remote: MemoryRemoteStore) {
  const local = new MemoryLocalStore();
  return { local, engine: new SyncEngine({ local, remote }) };
}

const putItem = (row: Item) => ({ action: "put", table: "items", row }) as const;

describe("2端末の同期", () => {
  it("片方の追加がもう片方に届く", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);

    expect((await a.engine.sync()).status).toBe("ok");
    await b.engine.sync();

    expect(b.local.rows.items.get("i1")?.name).toBe("とうふ");
    expect(await a.local.pendingCount()).toBe(0);
  });

  it("同じ品目の競合は新しい updatedAt を取り、後から送った古い変更は負ける", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await a.local.commit([putItem(item("i1", T(5), { memo: "新しい" }))]);
    await b.local.commit([putItem(item("i1", T(3), { memo: "古い" }))]);
    await a.engine.sync();
    const result = await b.engine.sync();
    await a.engine.sync();

    expect(result.superseded).toBe(1);
    expect(remote.rows.items).toHaveLength(1);
    expect(remote.rows.items[0]?.memo).toBe("新しい");
    expect(a.local.rows.items.get("i1")?.memo).toBe("新しい");
    expect(b.local.rows.items.get("i1")?.memo).toBe("新しい");
  });

  it("新しい変更が後から届けばリモートを上書きする", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await a.local.commit([putItem(item("i1", T(3), { memo: "古い" }))]);
    await b.local.commit([putItem(item("i1", T(5), { memo: "新しい" }))]);
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    expect(a.local.rows.items.get("i1")?.memo).toBe("新しい");
  });

  it("同時刻の競合でも2台が同じ結果になる", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1), { memo: "A" }))]);
    await b.local.commit([putItem(item("i1", T(1), { memo: "B" }))]);
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    expect(a.local.rows.items.get("i1")?.memo).toBe(b.local.rows.items.get("i1")?.memo);
  });

  it("オフラインの間は貯めて、つながったら送る", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    remote.offline = true;
    await a.local.commit([putItem(item("i1", T(1))), putItem(item("i2", T(2)))]);

    const offline = await a.engine.sync();
    expect(offline.status).toBe("failed");
    expect(offline.error?.kind).toBe("offline");
    expect(offline.pending).toBe(2);
    expect(a.local.rows.items.size).toBe(2);

    remote.offline = false;
    const online = await a.engine.sync();
    expect(online.status).toBe("ok");
    expect(online.pending).toBe(0);
    expect(remote.rows.items).toHaveLength(2);
  });

  it("ID で行を探すので、別の端末が行を消してずれても正しい行に書く", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([
      putItem(item("i1", T(1))),
      putItem(item("i2", T(1))),
      putItem(item("i3", T(1))),
    ]);
    await a.engine.sync();
    await b.engine.sync();

    await a.local.commit([{ action: "delete", table: "items", id: "i1", at: T(2) }]);
    await a.engine.sync();
    await b.local.commit([putItem(item("i3", T(3), { memo: "更新" }))]);
    await b.engine.sync();

    expect(remote.rows.items.map((row) => [row.id, row.memo])).toEqual([
      ["i2", ""],
      ["i3", "更新"],
    ]);
    expect(b.local.rows.items.has("i1")).toBe(false);
  });

  it("消す操作より新しい変更があればリモートの行を残す", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await b.local.commit([{ action: "delete", table: "items", id: "i1", at: T(2) }]);
    await a.local.commit([putItem(item("i1", T(3), { memo: "残す" }))]);
    await a.engine.sync();
    const result = await b.engine.sync();

    expect(result.superseded).toBe(1);
    expect(b.local.rows.items.get("i1")?.memo).toBe("残す");
  });

  it("消した行を古い端末が直すと復活する(消した印を持たないため。既知の制限)", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await b.local.commit([putItem(item("i1", T(2), { memo: "オフラインの変更" }))]);
    await a.local.commit([{ action: "delete", table: "items", id: "i1", at: T(3) }]);
    await a.engine.sync();
    await b.engine.sync();

    expect(remote.rows.items.map((row) => row.id)).toEqual(["i1"]);
  });

  it("History は続きだけを読み、両方の端末に重ならず残る", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([{ action: "put", table: "history", row: history("h1") }]);
    await a.engine.sync();
    await b.engine.sync();
    await b.local.commit([{ action: "put", table: "history", row: history("h2") }]);
    await b.engine.sync();
    await a.engine.sync();

    expect(await a.local.historyCursor()).toEqual({ position: 2, lastId: "h2" });
    expect([...a.local.rows.history.keys()].sort()).toEqual(["h1", "h2"]);
    expect(remote.rows.history).toHaveLength(2);
  });

  it("History だけの push は ID の読み取りをしない", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    await a.local.commit([{ action: "put", table: "history", row: history("h1") }]);
    await a.engine.sync();
    expect(remote.calls).toEqual({ locate: 0, write: 1, pull: 1 });
  });

  it("pull の間に足された変更を上書きせず、次に送る", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();

    remote.afterPull = async () => {
      remote.afterPull = null;
      await a.local.commit([putItem(item("i1", T(2), { memo: "同期中の変更" }))]);
    };
    await a.engine.sync();
    expect(a.local.rows.items.get("i1")?.memo).toBe("同期中の変更");
    expect(await a.local.pendingCount()).toBe(1);

    await a.engine.sync();
    expect(remote.rows.items[0]?.memo).toBe("同期中の変更");
  });

  it("不正な行があっても、その行のローカルの写しは消さず報告する", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();

    remote.rows.items.length = 0;
    remote.issues.push({
      table: "items",
      row: 2,
      id: "i1",
      problems: [{ column: "updated_at", message: "日時ではない" }],
    });
    const result = await a.engine.sync();

    expect(result.issues).toHaveLength(1);
    expect(a.local.rows.items.has("i1")).toBe(true);
  });

  it("店舗の手の順番も editedAt の後勝ちで決まる", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    const order = (categoryIds: string[], editedAt: string): StoreOrder => ({
      storeId: "s1",
      categoryIds,
      editedAt,
    });
    await a.local.commit([
      { action: "put", table: "storeOrders", row: order(["c1", "c2"], T(5)) },
    ]);
    await b.local.commit([
      { action: "put", table: "storeOrders", row: order(["c2", "c1"], T(3)) },
    ]);
    await a.engine.sync();
    await b.engine.sync();

    expect(remote.rows.storeOrders).toHaveLength(1);
    expect(b.local.rows.storeOrders.get("s1")?.categoryIds).toEqual(["c1", "c2"]);
  });
});

describe("回数の制限", () => {
  it("多くの変更を1回の読み取りと1回の書き込みにまとめる", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    await a.local.commit(
      Array.from({ length: 150 }, (_, i) => putItem(item(`i${i}`, T(1)))),
    );
    await a.engine.sync();
    expect(remote.calls).toEqual({ locate: 1, write: 1, pull: 1 });
  });

  it("1回の上限を超える分は分けて送る", async () => {
    const remote = new MemoryRemoteStore();
    const local = new MemoryLocalStore();
    const engine = new SyncEngine({ local, remote, maxOpsPerPush: 10 });
    await local.commit(Array.from({ length: 25 }, (_, i) => putItem(item(`i${i}`, T(1)))));
    await engine.sync();
    expect(remote.calls.write).toBe(3);
    expect(remote.rows.items).toHaveLength(25);
  });

  it("毎分の上限に届いたら残して、時間がたてば再開する", async () => {
    const remote = new MemoryRemoteStore();
    const local = new MemoryLocalStore();
    let now = 0;
    const engine = new SyncEngine({
      local,
      remote,
      now: () => now,
      maxOpsPerPush: 1,
      limits: { readsPerWindow: 100, writesPerWindow: 2, windowMs: 60_000 },
    });
    await local.commit([
      putItem(item("i1", T(1))),
      putItem(item("i2", T(1))),
      putItem(item("i3", T(1))),
    ]);

    const first = await engine.sync();
    expect(first.status).toBe("deferred");
    expect(first.pending).toBe(1);
    expect(first.pulled).toBe(true);

    now = 60_001;
    const second = await engine.sync();
    expect(second.status).toBe("ok");
    expect(second.pending).toBe(0);
  });

  it("同時に呼んでも1回しか走らない", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const first = a.engine.sync();
    const second = a.engine.sync();
    expect(first).toBe(second);
    await first;
    expect(remote.calls.pull).toBe(1);
  });
});

describe("planPush", () => {
  const op = (seq: number, row: Item): PendingOp => ({
    action: "put",
    table: "items",
    row,
    seq,
  });

  it("同じ行の操作は最後の1件にまとめる", () => {
    const ops = coalesceOps([
      op(1, item("i1", T(1), { memo: "1" })),
      op(2, item("i2", T(1))),
      op(3, item("i1", T(2), { memo: "2" })),
    ]);
    expect(ops.map((o) => o.seq).sort()).toEqual([2, 3]);
  });

  it("重なった行は新しい1行を残し、後ろの行から消す", () => {
    const plan = planPush([op(1, item("i1", T(9)))], {
      items: [
        { id: "i1", rowNumber: 2, version: T(1) },
        { id: "i1", rowNumber: 5, version: T(2) },
        { id: "i1", rowNumber: 7, version: T(1) },
      ],
    });
    expect(
      plan.writes.map((w) => [w.kind, w.kind === "insert" ? 0 : w.rowNumber]),
    ).toEqual([
      ["update", 5],
      ["delete", 7],
      ["delete", 2],
    ]);
  });

  it("参照される表を先に足す", () => {
    const plan = planPush(
      [
        op(1, item("i1", T(1), { categoryId: "c1" })),
        {
          action: "put",
          table: "categories",
          row: { id: "c1", name: "鮮魚", sort: 1 },
          seq: 2,
        },
      ],
      { items: [], categories: [] },
    );
    expect(plan.writes.map((w) => w.table)).toEqual(["categories", "items"]);
  });

  it("版の無い表は常に上書きする", () => {
    const plan = planPush(
      [
        {
          action: "put",
          table: "lists",
          row: { id: "l1", name: "スーパー", sort: 1 },
          seq: 1,
        },
      ],
      { lists: [{ id: "l1", rowNumber: 2, version: null }] },
    );
    expect(plan.writes[0]?.kind).toBe("update");
  });
});
