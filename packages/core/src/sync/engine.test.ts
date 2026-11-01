import { describe, expect, it } from "vitest";

import type { HistoryEntry, Item, ShoppingList, StoreOrder } from "../types.ts";
import { SyncEngine } from "./engine.ts";
import { MemoryLocalStore, MemoryRemoteStore } from "./memory.ts";
import { coalesceOps, planPush } from "./plan.ts";
import type { PendingOp, RemoteWrite } from "./types.ts";

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
    categorySource: null,
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

  it("消しても行は残り、墓石として pull から除かれる", async () => {
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
      ["i1", ""],
      ["i2", ""],
      ["i3", "更新"],
    ]);
    expect(remote.deletedAt.items.get(1)).toBe(T(2));
    expect(b.local.rows.items.has("i1")).toBe(false);
    expect([...a.local.rows.items.keys()].sort()).toEqual(["i2", "i3"]);
  });

  it("消す × 直す: 消した印のほうが新しければ、オフラインの編集で復活しない", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await b.local.commit([putItem(item("i1", T(2), { memo: "オフラインの変更" }))]);
    await a.local.commit([{ action: "delete", table: "items", id: "i1", at: T(3) }]);
    await a.engine.sync();
    const result = await b.engine.sync();
    await a.engine.sync();

    expect(result.superseded).toBe(1);
    expect(a.local.rows.items.has("i1")).toBe(false);
    expect(b.local.rows.items.has("i1")).toBe(false);
    expect(remote.rows.items[0]?.memo).toBe("");
  });

  it("消す × 直す: 編集のほうが新しければ、墓石を越えて生き返る", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await a.local.commit([{ action: "delete", table: "items", id: "i1", at: T(2) }]);
    await b.local.commit([putItem(item("i1", T(3), { memo: "残す" }))]);
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    expect(a.local.rows.items.get("i1")?.memo).toBe("残す");
    expect(b.local.rows.items.get("i1")?.memo).toBe("残す");
    expect(remote.deletedAt.items.size).toBe(0);
  });

  it("消す × 直す: 消す操作が遅れて届いても、新しい編集を消さない", async () => {
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

  it("消す × 直す: 読んでから書くまでの間に新しい編集が入っても、書く順に依らず残る", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await b.local.commit([{ action: "delete", table: "items", id: "i1", at: T(2) }]);
    remote.afterLocate = async () => {
      await a.local.commit([putItem(item("i1", T(3), { memo: "残す" }))]);
      await a.engine.sync();
    };
    await b.engine.sync();
    await a.engine.sync();

    expect(remote.deletedAt.items.get(1)).toBe(T(2));
    expect(a.local.rows.items.get("i1")?.memo).toBe("残す");
    expect(b.local.rows.items.get("i1")?.memo).toBe("残す");
  });

  it("消した品目をもう一度消しても、新しいほうの時刻が残る", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await a.local.commit([{ action: "delete", table: "items", id: "i1", at: T(3) }]);
    await b.local.commit([{ action: "delete", table: "items", id: "i1", at: T(2) }]);
    await a.engine.sync();
    await b.engine.sync();

    expect(remote.deletedAt.items.get(1)).toBe(T(3));
    expect(await b.local.pendingCount()).toBe(0);
  });

  it("送っていない品目を消すと、リモートには何も書かない", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    await a.local.commit([
      putItem(item("i1", T(1))),
      { action: "delete", table: "items", id: "i1", at: T(2) },
    ]);
    const result = await a.engine.sync();

    expect(result.pending).toBe(0);
    expect(remote.rows.items).toEqual([]);
    expect(remote.calls.write).toBe(0);
  });

  it("行が並行して増える: 読んでから書くまでに足された行を上書きしない", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1))), putItem(item("i2", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await a.local.commit([
      putItem(item("a1", T(2))),
      putItem(item("i2", T(2), { memo: "更新" })),
      { action: "delete", table: "items", id: "i1", at: T(2) },
    ]);
    remote.afterLocate = async () => {
      await b.local.commit([putItem(item("b1", T(2))), putItem(item("b2", T(2)))]);
      await b.engine.sync();
    };
    await a.engine.sync();
    await b.engine.sync();

    expect(remote.rows.items.map((row) => row.id)).toEqual(["i1", "i2", "b1", "b2", "a1"]);
    expect(remote.rows.items[1]?.memo).toBe("更新");
    for (const { local } of [a, b]) {
      expect([...local.rows.items.keys()].sort()).toEqual(["a1", "b1", "b2", "i2"]);
    }
  });

  it("読んでから書くまでに別の端末が消しても、行がずれず正しい行に書く", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    await a.local.commit([putItem(item("i1", T(1))), putItem(item("i2", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await a.local.commit([putItem(item("i2", T(3), { memo: "更新" }))]);
    remote.afterLocate = async () => {
      await b.local.commit([{ action: "delete", table: "items", id: "i1", at: T(2) }]);
      await b.engine.sync();
    };
    await a.engine.sync();

    expect(remote.rows.items.map((row) => [row.id, row.memo])).toEqual([
      ["i1", ""],
      ["i2", "更新"],
    ]);
    expect(remote.deletedAt.items.get(1)).toBe(T(2));
  });

  it("マスタも updatedAt の後勝ちで決まり、消すと墓石になる", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    const b = device(remote);
    const list = (name: string, updatedAt: string): ShoppingList => ({
      id: "l1",
      name,
      sort: 1,
      updatedAt,
    });
    await a.local.commit([{ action: "put", table: "lists", row: list("最初", T(1)) }]);
    await a.engine.sync();
    await b.engine.sync();

    await a.local.commit([{ action: "put", table: "lists", row: list("新しい", T(5)) }]);
    await b.local.commit([{ action: "put", table: "lists", row: list("古い", T(3)) }]);
    await a.engine.sync();
    const result = await b.engine.sync();
    expect(result.superseded).toBe(1);
    expect(b.local.rows.lists.get("l1")?.name).toBe("新しい");

    await b.local.commit([{ action: "delete", table: "lists", id: "l1", at: T(6) }]);
    await b.engine.sync();
    await a.engine.sync();
    expect(remote.rows.lists).toHaveLength(1);
    expect(a.local.rows.lists.has("l1")).toBe(false);
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

describe("拒否された操作の隔離", () => {
  const rejectId = (id: string) => (write: RemoteWrite) =>
    write.kind === "insert" && write.table === "items" && write.row.id === id;

  function batch(ids: string[]) {
    return ids.map((id) => putItem(item(id, T(1))));
  }

  it("原因の1件だけを issues に出し、残りを送る", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    await a.local.commit(batch(["i1", "i2", "bad", "i3", "i4"]));
    remote.rejects = rejectId("bad");

    const result = await a.engine.sync();

    expect(result.status).toBe("ok");
    expect(result.pushed).toBe(4);
    expect(result.pending).toBe(1);
    expect(result.pulled).toBe(true);
    expect(remote.rows.items.map((row) => row.id).sort()).toEqual(["i1", "i2", "i3", "i4"]);
    expect(result.issues).toMatchObject([{ table: "items", row: 0, id: "bad" }]);
    expect(a.local.rows.items.has("bad")).toBe(true);
  });

  it("隔離した操作は送り直さず、報告を続け、後ろの操作を詰まらせない", async () => {
    const remote = new MemoryRemoteStore();
    const local = new MemoryLocalStore();
    const engine = new SyncEngine({ local, remote, maxOpsPerPush: 1 });
    await local.commit(batch(["bad", "i1"]));
    remote.rejects = rejectId("bad");

    const first = await engine.sync();
    expect(first.pushed).toBe(1);
    const writes = remote.calls.write;

    await local.commit(batch(["i2"]));
    const second = await engine.sync();

    expect(remote.calls.write).toBe(writes + 1);
    expect(second.issues.map((issue) => issue.id)).toEqual(["bad"]);
    expect(remote.rows.items.map((row) => row.id)).toEqual(["i1", "i2"]);
  });

  it("同じ行を直せば送り直し、通れば隔離を解く", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    await a.local.commit(batch(["bad"]));
    remote.rejects = (write) =>
      write.kind !== "tombstone" && write.table === "items" && write.row.memo === "";
    expect((await a.engine.sync()).issues).toHaveLength(1);

    await a.local.commit([putItem(item("bad", T(2), { memo: "直した" }))]);
    const fixed = await a.engine.sync();

    expect(fixed.issues).toEqual([]);
    expect(fixed.pending).toBe(0);
    expect(remote.rows.items[0]?.memo).toBe("直した");
  });

  it("書き込みの回数の上限に届いたら残して、次に続ける", async () => {
    const remote = new MemoryRemoteStore();
    const local = new MemoryLocalStore();
    let now = 0;
    const engine = new SyncEngine({
      local,
      remote,
      now: () => now,
      limits: { readsPerWindow: 100, writesPerWindow: 3, windowMs: 60_000 },
    });
    await local.commit(batch(["i1", "bad", "i2", "i3"]));
    remote.rejects = rejectId("bad");

    const first = await engine.sync();
    expect(first.status).toBe("deferred");
    expect(first.pending).toBeGreaterThan(0);

    now = 60_001;
    const second = await engine.sync();
    now = 120_002;
    const third = await engine.sync();
    expect(remote.rows.items.map((row) => row.id).sort()).toEqual(["i1", "i2", "i3"]);
    expect(second.issues.concat(third.issues).map((issue) => issue.id)).toContain("bad");
  });

  it("分けて送る途中でつながらなくなっても、書けた分は送り直さない", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    await a.local.commit([
      { action: "put", table: "history", row: history("h1") },
      { action: "put", table: "history", row: history("h2") },
      { action: "put", table: "history", row: history("bad") },
      { action: "put", table: "history", row: history("h3") },
    ]);
    remote.rejects = (write) => {
      if (write.kind !== "insert" || write.table !== "history") return false;
      if (write.row.id !== "bad") return false;
      // 分けた後ろ半分の拒否の直後に回線が切れる
      remote.offline = remote.rows.history.length > 0;
      return true;
    };
    const failed = await a.engine.sync();
    expect(failed.status).toBe("failed");

    remote.offline = false;
    remote.rejects = null;
    await a.engine.sync();
    expect(remote.rows.history.map((row) => row.id)).toEqual(["h1", "h2", "bad", "h3"]);
  });

  it("拒否以外の失敗は分けずに止める", async () => {
    const remote = new MemoryRemoteStore();
    const a = device(remote);
    await a.local.commit(batch(["i1", "i2"]));
    remote.offline = true;
    const result = await a.engine.sync();
    expect(result.status).toBe("failed");
    expect(result.issues).toEqual([]);
    expect(result.pending).toBe(2);
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

  const writes = (plan: ReturnType<typeof planPush>) => plan.steps.map(({ write }) => write);

  it("重なった行は消さず、新しい1行だけを書く", () => {
    const plan = planPush([op(1, item("i1", T(9)))], {
      items: [
        { id: "i1", rowNumber: 2, version: T(1) },
        { id: "i1", rowNumber: 5, version: T(2) },
        { id: "i1", rowNumber: 7, version: null },
      ],
    });
    expect(
      writes(plan).map((w) => [w.kind, w.kind === "insert" ? 0 : w.rowNumber]),
    ).toEqual([["update", 5]]);
  });

  it("消す操作は墓石の書き込みになる", () => {
    const plan = planPush(
      [{ action: "delete", table: "items", id: "i1", at: T(5), seq: 1 }],
      { items: [{ id: "i1", rowNumber: 3, version: T(1) }] },
    );
    expect(writes(plan)).toEqual([
      { kind: "tombstone", table: "items", rowNumber: 3, at: T(5) },
    ]);
  });

  it("同時刻の消す操作は負ける", () => {
    const plan = planPush(
      [{ action: "delete", table: "items", id: "i1", at: T(5), seq: 1 }],
      { items: [{ id: "i1", rowNumber: 3, version: T(5) }] },
    );
    expect(plan.steps).toEqual([]);
    expect(plan.superseded).toBe(1);
  });

  it("参照される表を先に足す", () => {
    const plan = planPush(
      [
        op(1, item("i1", T(1), { categoryId: "c1" })),
        {
          action: "put",
          table: "categories",
          row: { id: "c1", name: "鮮魚", sort: 1, updatedAt: T(1) },
          seq: 2,
        },
      ],
      { items: [], categories: [] },
    );
    expect(writes(plan).map((w) => w.table)).toEqual(["categories", "items"]);
  });

  it("読めない版の行は上書きする", () => {
    const plan = planPush(
      [
        {
          action: "put",
          table: "lists",
          row: { id: "l1", name: "スーパー", sort: 1, updatedAt: T(1) },
          seq: 1,
        },
      ],
      { lists: [{ id: "l1", rowNumber: 2, version: null }] },
    );
    expect(writes(plan)[0]?.kind).toBe("update");
  });
});
