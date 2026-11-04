import { HOUR_MS, MemoryLocalStore, MemoryRemoteStore, STORE_CORRECTION_MS, SyncEngine, TRIP_GAP_MS, type Id, type Item, type LocalChange, type Store } from "@shopping-list/core";
import { beforeEach, describe, expect, it } from "vitest";

import { SqliteLocalStore } from "./localStore.ts";
import { Repository } from "./repository.ts";
import { openTestDatabase } from "./testDb.ts";

const START = Date.parse("2028-01-01T00:00:00.000Z");
const NONE = { categoryId: null, categorySource: null };
const CATEGORIES: Id[] = ["a", "b", "c"];

function itemRow(id: Id, listId: Id): Item {
  return {
    id,
    listId,
    name: "架空の品物",
    categoryId: null,
    categorySource: null,
    memo: "",
    checked: false,
    checkedAt: null,
    checkedStoreId: null,
    checkedUpdatedAt: "",
    updatedAt: "",
  };
}

describe("Repository", () => {
  let store: SqliteLocalStore;
  let repo: Repository;
  let clock: number;
  let order: readonly Id[] | null;
  let next: number;

  beforeEach(() => {
    store = new SqliteLocalStore(openTestDatabase());
    clock = START;
    next = 0;
    order = CATEGORIES;
    repo = new Repository({
      store,
      newId: () => `id-${++next}`,
      now: () => new Date(clock).toISOString(),
      learnedOrder: () => order,
    });
  });

  const add = (name: string, categoryId: Id | null = null) =>
    repo.addItem("list", name, categoryId ? { categoryId, categorySource: "history" } : NONE);
  const itemOf = (id: Id) => store.rows("items").find((row) => row.id === id);

  describe("applyInferredCategory", () => {
    it("未分類の品目に推定を入れ、版を進める", () => {
      const item = add("架空の品物")!;
      clock += 1000;
      repo.applyInferredCategory(item.id, "a");
      expect(itemOf(item.id)).toMatchObject({
        categoryId: "a",
        categorySource: "inferred",
        updatedAt: new Date(clock).toISOString(),
      });
    });

    it("すでにカテゴリがあれば上書きしない", () => {
      const item = add("架空の品物")!;
      repo.updateItem(item.id, { categoryId: "b" });
      const decided = itemOf(item.id);
      clock += 1000;
      repo.applyInferredCategory(item.id, "a");
      expect(itemOf(item.id)).toEqual(decided);
    });

    it("消えた品目には何もしない", () => {
      const item = add("架空の品物")!;
      repo.deleteItem(item.id);
      repo.applyInferredCategory(item.id, "a");
      expect(itemOf(item.id)).toBeUndefined();
    });

    it("推定の品目を利用者が直すと出どころが利用者になる", () => {
      const item = add("架空の品物")!;
      repo.applyInferredCategory(item.id, "a");
      repo.updateItem(item.id, { categoryId: "b" });
      expect(itemOf(item.id)?.categorySource).toBe("user");
    });
  });

  it("同じ名前がまだ買っていない状態であれば足さない", () => {
    expect(add(" にんじん ")?.name).toBe("にんじん");
    expect(add("ニンジン")).toBeNull();
    expect(add("  ")).toBeNull();
    expect(store.rows("items")).toHaveLength(1);
  });

  it("リストを消すと品目も消える", () => {
    const listId = repo.addList("架空のリスト");
    repo.addItem(listId, "品物", NONE);
    repo.deleteList(listId);
    expect(store.rows("lists")).toEqual([]);
    expect(store.rows("items")).toEqual([]);
  });

  it("リストを消すと品目も墓石の操作になり、同期の後にシートの品目が消える", async () => {
    const remote = new MemoryRemoteStore();
    const engine = new SyncEngine({ local: store, remote });
    const listId = repo.addList("架空のリスト");
    const item = repo.addItem(listId, "品物", NONE);
    await engine.sync();
    clock += 1000;

    repo.deleteList(listId);
    await engine.sync();

    expect(remote.rows.items.map((row) => row.id)).toEqual([item?.id]);
    expect(remote.deletedAt.items.size).toBe(1);
    expect(remote.deletedAt.lists.size).toBe(1);
  });

  it("リストを消す前にほかの端末が足した品目も、次の同期で片付ける", async () => {
    const remote = new MemoryRemoteStore();
    const engine = new SyncEngine({ local: store, remote });
    const other = new MemoryLocalStore();
    const otherEngine = new SyncEngine({ local: other, remote });
    const listId = repo.addList("架空のリスト");
    await engine.sync();
    await otherEngine.sync();
    const at = new Date(clock).toISOString();
    await other.commit([
      {
        action: "put",
        table: "items",
        row: { ...itemRow("late", listId), checkedUpdatedAt: at, updatedAt: at },
      },
    ]);
    await otherEngine.sync();

    // まだ読んでいない端末がリストを消す
    clock += 1000;
    repo.deleteList(listId);
    await engine.sync();
    expect(store.rows("items").map((row) => row.id)).toEqual(["late"]);

    expect(repo.removeOrphanItems()).toBe(1);
    await engine.sync();
    await otherEngine.sync();

    expect(remote.deletedAt.items.size).toBe(1);
    expect(other.rows.items.size).toBe(0);
  });

  it("カテゴリを直すと user になり、名前だけなら元のまま", () => {
    const item = add("品物", "a");
    repo.updateItem(item?.id ?? "", { name: "新しい名前" });
    expect(itemOf(item?.id ?? "")?.categorySource).toBe("history");
    repo.updateItem(item?.id ?? "", { categoryId: "b" });
    expect(itemOf(item?.id ?? "")).toMatchObject({ categoryId: "b", categorySource: "user" });
  });

  it("向きを先に切り替えても、最初のチェックで店舗を聞く", () => {
    const [a, b] = [add("品物1"), add("品物2")];
    repo.setDirection("list", "desc");
    expect(repo.checkItem(a?.id ?? "")).toBe(true);
    // スキップしたら聞き直さない
    expect(repo.checkItem(b?.id ?? "")).toBe(false);
  });

  it("sort が重なったカテゴリも動かせる", () => {
    const row = (id: Id) => ({ id, name: id, sort: 1, updatedAt: new Date(clock).toISOString() });
    store.commitNow([row("a"), row("b"), { ...row("c"), sort: 2 }].map((category) => ({ action: "put", table: "categories", row: category })));
    repo.moveCategory("b", -1);
    expect(store.rows("categories").map((category) => category.id)).toEqual(["b", "a", "c"]);
  });

  it("最初のチェックだけ店舗を聞き、選ぶとチェックに店舗が付く", () => {
    const [a, b] = [add("品物1"), add("品物2")];
    expect(repo.checkItem(a?.id ?? "")).toBe(true);
    expect(itemOf(a?.id ?? "")?.checkedStoreId).toBeNull();
    const storeId = repo.addStore("list", "架空の店", null);
    repo.selectStore("list", storeId);
    expect(itemOf(a?.id ?? "")?.checkedStoreId).toBe(storeId);
    expect(repo.checkItem(b?.id ?? "")).toBe(false);
    expect(itemOf(b?.id ?? "")?.checkedStoreId).toBe(storeId);
  });

  it("スキップしたら、そのトリップでは聞かず、店舗も付けない", () => {
    const [a, b] = [add("品物1"), add("品物2")];
    expect(repo.checkItem(a?.id ?? "")).toBe(true);
    expect(repo.checkItem(b?.id ?? "")).toBe(false);
    expect(itemOf(b?.id ?? "")?.checkedStoreId).toBeNull();
  });

  it("チェックの前に向きを切り替えても、最初のチェックで店舗を聞く", () => {
    const [a, b] = [add("品物1"), add("品物2")];
    repo.setDirection("list", "desc");
    expect(repo.checkItem(a?.id ?? "")).toBe(true);
    expect(repo.checkItem(b?.id ?? "")).toBe(false);
  });

  it("間が空くと次のトリップになり、また店舗を聞く", () => {
    const [a, b] = [add("品物1"), add("品物2")];
    repo.checkItem(a?.id ?? "");
    clock += TRIP_GAP_MS + 1;
    expect(repo.checkItem(b?.id ?? "")).toBe(true);
  });

  it("店舗を選び直すと、このトリップのチェックを付け替える", () => {
    const item = add("品物");
    repo.checkItem(item?.id ?? "");
    const [first, second] = [repo.addStore("list", "店1", null), repo.addStore("list", "店2", null)];
    repo.selectStore("list", first);
    repo.selectStore("list", second);
    expect(itemOf(item?.id ?? "")?.checkedStoreId).toBe(second);
  });

  it("最後のチェックから5分以内は付け替える", () => {
    const item = add("品物");
    const [first, second] = [repo.addStore("list", "店1", null), repo.addStore("list", "店2", null)];
    repo.selectStore("list", first);
    repo.checkItem(item?.id ?? "");
    clock += STORE_CORRECTION_MS;
    repo.selectStore("list", second);
    expect(itemOf(item?.id ?? "")?.checkedStoreId).toBe(second);
    expect(repo.currentSession("list")?.storeId).toBe(second);
  });

  it("5分を超えたら、前のチェックはそのままで以後を新しいトリップにする", () => {
    const [a, b] = [add("品物1"), add("品物2")];
    const [first, second, third] = [repo.addStore("list", "店1", null), repo.addStore("list", "店2", null), repo.addStore("list", "店3", null)];
    repo.selectStore("list", first);
    repo.checkItem(a?.id ?? "");
    const before = itemOf(a?.id ?? "");
    repo.setDirection("list", "desc");
    clock += STORE_CORRECTION_MS + 1;

    repo.selectStore("list", second);
    expect(itemOf(a?.id ?? "")).toBe(before);
    expect(repo.currentSession("list")?.startedAt).toBe(new Date(clock).toISOString());
    expect(repo.currentSession("list")?.direction.direction).toBe("asc");

    clock += 1000;
    expect(repo.checkItem(b?.id ?? "")).toBe(false);
    expect(itemOf(b?.id ?? "")?.checkedStoreId).toBe(second);

    // 新しいトリップの訂正は、前の店舗のチェックに触らない
    clock += 1000;
    repo.selectStore("list", third);
    expect(itemOf(a?.id ?? "")?.checkedStoreId).toBe(first);
    expect(itemOf(b?.id ?? "")?.checkedStoreId).toBe(third);
  });

  it("同じ店舗を選び直しても、トリップは切れない", () => {
    const item = add("品物");
    const storeId = repo.addStore("list", "店1", null);
    repo.selectStore("list", storeId);
    repo.checkItem(item?.id ?? "");
    const startedAt = repo.currentSession("list")?.startedAt;
    clock += STORE_CORRECTION_MS + 1;
    repo.selectStore("list", storeId);
    expect(repo.currentSession("list")?.startedAt).toBe(startedAt);
  });

  it("チェックの変更は checkedUpdatedAt だけ、ほかの編集は updatedAt だけを進める", () => {
    const item = add("品物", "a");
    const id = item?.id ?? "";
    const storeId = repo.addStore("list", "店1", null);
    const created = new Date(clock).toISOString();
    clock += 1000;
    repo.checkItem(id);
    expect(itemOf(id)?.updatedAt).toBe(created);
    expect(itemOf(id)?.checkedUpdatedAt).toBe(new Date(clock).toISOString());

    const checkedAt = itemOf(id)?.checkedUpdatedAt;
    clock += 1000;
    repo.updateItem(id, { memo: "メモ" });
    repo.deleteCategory("a");
    expect(itemOf(id)?.checkedUpdatedAt).toBe(checkedAt);
    expect(itemOf(id)?.updatedAt).toBe(new Date(clock).toISOString());

    const updatedAt = itemOf(id)?.updatedAt;
    clock += 1000;
    repo.selectStore("list", storeId);
    repo.deleteStore(storeId);
    clock += 1000;
    repo.uncheckItem(id);
    expect(itemOf(id)?.updatedAt).toBe(updatedAt);
    expect(itemOf(id)?.checkedUpdatedAt).toBe(new Date(clock).toISOString());
  });

  it("順番を学んでいない店舗では向きを自動で切り替えない", () => {
    order = null;
    const storeId = repo.addStore("list", "架空の店", null);
    repo.selectStore("list", storeId);
    for (const categoryId of ["c", "b", "a"]) {
      clock += 60_000;
      repo.checkItem(add(`品物${categoryId}`, categoryId)?.id ?? "");
    }
    expect(repo.currentSession("list")?.direction).toMatchObject({ direction: "asc", autoSwitched: false });
  });

  it("同じ名前の店舗は新しく登録せず、既存を使う", () => {
    const id = repo.addStore("list", "マルサン", { lat: 1, lng: 2 });
    expect(repo.addStore("list", " まるさん ", { lat: 3, lng: 4 })).toBe(id);
    expect(store.rows("stores")).toHaveLength(1);
    expect(store.rows("stores")[0]).toMatchObject({ name: "マルサン", lat: 1, lng: 2 });
    expect(repo.findStore("list", "まるさん")?.id).toBe(id);
    expect(repo.addStore("list", "別の店", null)).not.toBe(id);
  });

  describe("野良品目", () => {
    const stray = (name: string, categoryId: Id | null = null) =>
      repo.addStrayItem(name, categoryId ? { categoryId, categorySource: "inferred" } : NONE);
    const history = (id: Id, listId: Id, name: string, categoryId: Id): LocalChange => ({
      action: "put",
      table: "history",
      row: { id, listId, name, categoryId, categorySource: "history", storeId: null, tripId: null, checkedAt: new Date(START).toISOString(), checkedSeq: 0 },
    });

    beforeEach(() => {
      store.commitNow(
        CATEGORIES.map((id, index): LocalChange => ({ action: "put", table: "categories", row: { id, name: id, sort: index + 1, updatedAt: "" } })),
      );
    });

    it("リストを持たずに足し、同じ名前の野良品目は足さない。リストの品目とは別に数える", () => {
      const listId = repo.addList("架空のリスト");
      repo.addItem(listId, "ぎゅうにゅう", NONE);
      const item = stray(" ぎゅうにゅう ");
      expect(item).toMatchObject({ listId: null, name: "ぎゅうにゅう", checked: false });
      expect(stray("ギュウニュウ")).toBeNull();
      expect(stray("  ")).toBeNull();
      expect(store.rows("items").filter((row) => row.listId === null)).toHaveLength(1);
    });

    it("リストへ移し、移す先の記録でカテゴリを引き直す", () => {
      const listId = repo.addList("架空のリスト");
      store.commitNow([history("h1", listId, "架空の牛乳", "b")]);
      const item = stray("架空の牛乳", "a")!;
      clock += 1000;
      const moved = repo.moveStrayItem(item.id, listId);
      expect(moved).toMatchObject({ id: item.id, listId, categoryId: "b", categorySource: "history", updatedAt: new Date(clock).toISOString() });
      expect(itemOf(item.id)).toEqual(moved);
      // もう野良品目ではないので、もう一度は移さない
      expect(repo.moveStrayItem(item.id, listId)).toBeNull();
    });

    it("利用者が決めたカテゴリと、記録の無い品目のカテゴリはそのまま移す", () => {
      const listId = repo.addList("架空のリスト");
      store.commitNow([history("h1", listId, "架空の牛乳", "b")]);
      const decided = stray("架空の牛乳")!;
      repo.updateItem(decided.id, { categoryId: "c" });
      expect(repo.moveStrayItem(decided.id, listId)).toMatchObject({ categoryId: "c", categorySource: "user" });
      const unknown = stray("ふしぎな品物", "a")!;
      expect(repo.moveStrayItem(unknown.id, listId)).toMatchObject({ categoryId: "a", categorySource: "inferred" });
    });

    it("移す先に同じ名前の買っていない品目があれば、野良品目を消してそれを返す", () => {
      const listId = repo.addList("架空のリスト");
      const existing = repo.addItem(listId, "ぎゅうにゅう", NONE)!;
      const item = stray("ギュウニュウ")!;
      expect(repo.moveStrayItem(item.id, listId)).toEqual(existing);
      expect(itemOf(item.id)).toBeUndefined();
    });

    it("無いリストへは移さない", () => {
      const item = stray("架空の牛乳")!;
      expect(repo.moveStrayItem(item.id, "deleted-list")).toBeNull();
      expect(itemOf(item.id)?.listId).toBeNull();
    });

    it("チェックせず、リストの片付けとリストの削除では消さない", () => {
      const listId = repo.addList("架空のリスト");
      const item = stray("架空の牛乳")!;
      expect(repo.checkItem(item.id)).toBe(false);
      expect(itemOf(item.id)?.checked).toBe(false);
      expect(repo.isShopping()).toBe(false);
      expect(repo.removeOrphanItems()).toBe(0);
      repo.deleteList(listId);
      expect(itemOf(item.id)).toBeDefined();
    });

    it("消すと墓石を送る", () => {
      const item = stray("架空の牛乳")!;
      const pending = store.pendingCountNow();
      repo.deleteItem(item.id);
      expect(itemOf(item.id)).toBeUndefined();
      expect(store.pendingCountNow()).toBe(pending + 1);
    });
  });

  describe("forgetItemName", () => {
    const bought = (id: Id, listId: Id, name: string, checkedAt: string): LocalChange => ({
      action: "put",
      table: "history",
      row: { id, listId, name, categoryId: null, categorySource: null, storeId: null, tripId: null, checkedAt, checkedSeq: 0 },
    });

    it("正規化した名前で記録し、同じ名前をもう一度忘れたら記録を使い回す", () => {
      repo.forgetItemName("list", " トマト ");
      expect(store.rows("forgottenItems")).toEqual([
        { id: "id-1", listId: "list", normalizedName: "とまと", forgottenAt: new Date(START).toISOString(), updatedAt: new Date(START).toISOString() },
      ]);
      clock += 1000;
      repo.forgetItemName("list", "とまと");
      expect(store.rows("forgottenItems")).toEqual([
        expect.objectContaining({ id: "id-1", forgottenAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString() }),
      ]);
      repo.forgetItemName("other", "とまと");
      repo.forgetItemName("list", "  ");
      expect(store.rows("forgottenItems")).toHaveLength(2);
    });

    it("時計がずれて履歴のほうが新しくても、今ある分を忘れる", () => {
      const future = new Date(START + 60_000).toISOString();
      store.commitNow([bought("h1", "list", "トマト", future)]);
      repo.forgetItemName("list", "トマト");
      expect(store.rows("forgottenItems")[0]).toMatchObject({ forgottenAt: future, updatedAt: new Date(START).toISOString() });
    });

    it("リストを消すと忘れた記録も墓石の操作になり、リストの無い記録は同期のたびに片付ける", async () => {
      const remote = new MemoryRemoteStore();
      const engine = new SyncEngine({ local: store, remote });
      const listId = repo.addList("架空のリスト");
      repo.forgetItemName(listId, "トマト");
      await engine.sync();
      clock += 1000;

      repo.deleteList(listId);
      expect(store.rows("forgottenItems")).toEqual([]);
      await engine.sync();
      expect(remote.deletedAt.forgottenItems.size).toBe(1);

      const kept = repo.addList("残るリスト");
      repo.forgetItemName(kept, "牛乳");
      const orphan = { id: "orphan", listId: "deleted-list", normalizedName: "なす", forgottenAt: "", updatedAt: "" };
      store.commitNow([{ action: "put", table: "forgottenItems", row: orphan }]);
      expect(repo.removeOrphanForgottenItems()).toBe(1);
      expect(store.rows("forgottenItems").map((row) => row.listId)).toEqual([kept]);
      expect(repo.removeOrphanForgottenItems()).toBe(0);
    });
  });

  it("リストの無い品目を墓石にする", () => {
    const listId = repo.addList("架空のリスト");
    const kept = repo.addItem(listId, "残る品物", NONE);
    store.commitNow([
      {
        action: "put",
        table: "items",
        row: { ...(kept as NonNullable<typeof kept>), id: "orphan", listId: "deleted-list" },
      },
    ]);
    const pending = store.pendingCountNow();

    expect(repo.removeOrphanItems()).toBe(1);

    expect(store.rows("items").map((row) => row.id)).toEqual([kept?.id]);
    expect(store.pendingCountNow()).toBe(pending + 1);
    expect(repo.removeOrphanItems()).toBe(0);
  });

  it("チェックを外すと記録も消える", () => {
    const item = add("品物");
    repo.checkItem(item?.id ?? "");
    repo.uncheckItem(item?.id ?? "");
    expect(itemOf(item?.id ?? "")).toMatchObject({ checked: false, checkedAt: null, checkedStoreId: null });
  });

  it("逆回りのチェックが3カテゴリに届くと、自動で降順にする", () => {
    const storeId = repo.addStore("list", "架空の店", null);
    repo.selectStore("list", storeId);
    for (const categoryId of ["c", "b", "a"]) {
      clock += 60_000;
      repo.checkItem(add(`品物${categoryId}`, categoryId)?.id ?? "");
    }
    expect(repo.currentSession("list")?.direction).toMatchObject({ direction: "desc", autoSwitched: true });
  });

  it("手で向きを切り替えたら、そのトリップでは自動で切り替えない", () => {
    const storeId = repo.addStore("list", "架空の店", null);
    repo.selectStore("list", storeId);
    repo.setDirection("list", "asc");
    for (const categoryId of ["c", "b", "a"]) {
      clock += 60_000;
      repo.checkItem(add(`品物${categoryId}`, categoryId)?.id ?? "");
    }
    expect(repo.currentSession("list")?.direction.direction).toBe("asc");
  });

  it("終わったトリップを History へ移す。店舗の無いチェックも移す", () => {
    const [a, b, open] = [add("品物1", "a"), add("品物2", "b"), add("未チェック")];
    const storeId = repo.addStore("list", "架空の店", null);
    repo.selectStore("list", storeId);
    repo.checkItem(a?.id ?? "");
    clock += 1000;
    repo.checkItem(b?.id ?? "");
    const free = add("店舗なし");
    clock += 1000;
    store.setSetting("shoppingSession", null);
    repo.checkItem(free?.id ?? "");

    expect(repo.finishTrips()).toBe(0);
    clock += TRIP_GAP_MS + 1;
    expect(repo.finishTrips()).toBe(3);

    expect(store.rows("items").map((row) => row.id)).toEqual([open?.id]);
    const history = store.rows("history");
    expect(history.map((row) => [row.name, row.storeId, row.checkedSeq])).toEqual([
      ["品物1", storeId, 0],
      ["品物2", storeId, 1],
      ["店舗なし", null, 0],
    ]);
    expect(history[0]?.tripId).toBe(history[1]?.tripId);
    expect(history[2]?.tripId).toBeNull();
  });

  it("店舗を消すと、品目の参照と手の順番も外す", () => {
    const item = add("品物");
    const storeId = repo.addStore("list", "架空の店", null);
    repo.checkItem(item?.id ?? "");
    repo.selectStore("list", storeId);
    repo.saveStoreOrder(storeId, ["a"]);
    repo.deleteStore(storeId);
    expect(store.rows("storeOrders")).toEqual([]);
    expect(itemOf(item?.id ?? "")?.checkedStoreId).toBeNull();
    expect(repo.currentSession("list")?.storeId).toBeNull();
  });

  it("カテゴリを消すと品目は未分類に戻る", () => {
    const categoryId = repo.addCategory("架空のカテゴリ");
    const item = add("品物", categoryId);
    repo.deleteCategory(categoryId);
    expect(itemOf(item?.id ?? "")).toMatchObject({ categoryId: null, categorySource: null });
  });

  it("カテゴリの順を隣と入れ替え、端では動かさない", () => {
    const [a, b] = [repo.addCategory("一"), repo.addCategory("二")];
    repo.moveCategory(b, -1);
    expect(store.rows("categories").map((row) => row.id)).toEqual([b, a]);
    repo.moveCategory(b, -1);
    expect(store.rows("categories").map((row) => row.id)).toEqual([b, a]);
  });

  it("時間が空いた買い物の状態は無いものとして扱う", () => {
    repo.checkItem(add("品物")?.id ?? "");
    clock += 4 * HOUR_MS;
    expect(repo.currentSession("list")).toBeNull();
  });

  describe("リストごとの店舗", () => {
    const stored = (id: Id) => store.rows("stores").find((row) => row.id === id);
    // リストの決まっていない店舗。版を上げる前に登録したもの
    const unassigned = (id: Id): Store => ({
      id,
      name: id,
      lat: null,
      lng: null,
      createdAt: "2027-01-01T00:00:00.000Z",
      updatedAt: "2027-01-01T00:00:00.000Z",
      listId: null,
    });
    const putStore = (row: Store) => store.commitNow([{ action: "put", table: "stores", row }]);
    const history = (id: Id, listId: Id, storeId: Id | null, checkedAt: string): LocalChange => ({
      action: "put",
      table: "history",
      row: { id, listId, name: "品物", categoryId: null, categorySource: null, storeId, tripId: null, checkedAt, checkedSeq: 0 },
    });

    it("新しい店舗はそのリストに属する", () => {
      expect(stored(repo.addStore("list", "店", null))?.listId).toBe("list");
    });

    it("別のリストなら同じ名前を別の店舗として持てる", () => {
      const a = repo.addStore("list", "店", null);
      const b = repo.addStore("other", "店", null);
      expect(b).not.toBe(a);
      expect(repo.findStore("list", "店")?.id).toBe(a);
      expect(repo.findStore("other", "店")?.id).toBe(b);
      expect(repo.findStore("third", "店")).toBeUndefined();
    });

    it("同じ名前の店舗はそのリストのものを先に見つける", () => {
      putStore({ ...unassigned("old"), name: "店" });
      const mine = { ...unassigned("mine"), name: "店", listId: "list" };
      putStore(mine);
      expect(repo.findStore("list", "店")?.id).toBe("mine");
    });

    it("リストの決まっていない店舗を選ぶと、そのリストに属する", () => {
      putStore(unassigned("old"));
      repo.selectStore("list", "old");
      expect(stored("old")?.listId).toBe("list");
      expect(store.rows("stores")).toHaveLength(1);
    });

    it("リストの決まっていない店舗と同じ名前で登録すると、足さずに属させる", () => {
      putStore({ ...unassigned("old"), name: "店" });
      expect(repo.addStore("list", "店", null)).toBe("old");
      expect(stored("old")?.listId).toBe("list");
    });

    it("チェックの記録から、最後に使ったリストを埋める", () => {
      repo.addList("リスト");
      const [early, late] = store.rows("lists").map((row) => row.id).concat(repo.addList("新しいリスト"));
      putStore(unassigned("old"));
      putStore(unassigned("unused"));
      store.commitNow([
        history("h1", late as Id, "old", "2027-01-01T00:00:00.000Z"),
        history("h2", early as Id, "old", "2027-02-01T00:00:00.000Z"),
      ]);
      const pending = store.pendingCountNow();

      expect(repo.assignStoreLists()).toBe(1);

      expect(stored("old")?.listId).toBe(early);
      expect(stored("unused")?.listId).toBeNull();
      expect(store.pendingCountNow()).toBe(pending + 1);
      expect(repo.assignStoreLists()).toBe(0);
    });

    it("品目のチェックも見て、履歴より新しければそのリストにする", () => {
      const [first, second] = [repo.addList("一"), repo.addList("二")];
      putStore(unassigned("old"));
      store.commitNow([history("h1", first, "old", "2027-01-01T00:00:00.000Z")]);
      const item = repo.addItem(second, "品物", NONE);
      store.commitNow([
        { action: "put", table: "items", row: { ...(item as Item), checked: true, checkedAt: "2027-02-01T00:00:00.000Z", checkedStoreId: "old" } },
      ]);
      repo.assignStoreLists();
      expect(stored("old")?.listId).toBe(second);
    });

    it("消えたリストの記録では埋めない", () => {
      const listId = repo.addList("残るリスト");
      putStore(unassigned("old"));
      store.commitNow([
        history("h1", listId, "old", "2027-01-01T00:00:00.000Z"),
        history("h2", "deleted-list", "old", "2027-02-01T00:00:00.000Z"),
      ]);
      repo.assignStoreLists();
      expect(stored("old")?.listId).toBe(listId);
    });

    it("リストを消すと店舗と手の順番も消え、ほかのリストの参照を外し、履歴は残す", () => {
      const [gone, kept] = [repo.addList("消すリスト"), repo.addList("残るリスト")];
      const storeId = repo.addStore(gone, "店", null);
      const other = repo.addStore(kept, "別の店", null);
      repo.saveStoreOrder(storeId, ["a"]);
      repo.saveStoreOrder(other, ["a"]);
      const item = repo.addItem(kept, "品物", NONE);
      store.commitNow([
        { action: "put", table: "items", row: { ...(item as Item), checked: true, checkedAt: "2027-02-01T00:00:00.000Z", checkedStoreId: storeId } },
        history("h1", gone, storeId, "2027-01-01T00:00:00.000Z"),
      ]);

      repo.deleteList(gone);

      expect(store.rows("stores").map((row) => row.id)).toEqual([other]);
      expect(store.rows("storeOrders").map((row) => row.storeId)).toEqual([other]);
      expect(itemOf(item?.id ?? "")?.checkedStoreId).toBeNull();
      expect(store.rows("history")).toHaveLength(1);
    });

    it("消したリストの買い物の状態を残さない", () => {
      const listId = repo.addList("リスト");
      repo.selectStore(listId, repo.addStore(listId, "店", null));
      repo.deleteList(listId);
      expect(repo.session()).toBeNull();
    });

    it("リストの無い店舗を手の順番ごと片付ける。リストの決まっていない店舗は残す", () => {
      const listId = repo.addList("リスト");
      const kept = repo.addStore(listId, "残る店", null);
      putStore({ ...unassigned("orphan"), listId: "deleted-list" });
      putStore(unassigned("old"));
      repo.saveStoreOrder("orphan", ["a"]);

      expect(repo.removeOrphanStores()).toBe(1);

      expect(store.rows("stores").map((row) => row.id).sort()).toEqual([kept, "old"].sort());
      expect(store.rows("storeOrders")).toEqual([]);
      expect(repo.removeOrphanStores()).toBe(0);
    });

    it("店舗を別のリストへ移すと、前のリストの買い物から外れる", () => {
      const storeId = repo.addStore("list", "店", null);
      repo.selectStore("list", storeId);
      repo.updateStore(storeId, { listId: "other" });
      expect(stored(storeId)?.listId).toBe("other");
      expect(repo.currentSession("list")?.storeId).toBeNull();
    });
  });

  describe("リストごとの買い物", () => {
    const addTo = (listId: Id, name: string) => repo.addItem(listId, name, NONE)?.id ?? "";

    it("別のリストではセッションなしとして扱う", () => {
      repo.selectStore("list", repo.addStore("list", "店", null));
      expect(repo.currentSession("list")).not.toBeNull();
      expect(repo.currentSession("other")).toBeNull();
      expect(repo.isShopping()).toBe(true);
    });

    it("別のリストのチェックには前のリストの店舗を付けず、店舗を聞く", () => {
      repo.selectStore("list", repo.addStore("list", "店", null));
      const id = addTo("other", "品物");
      expect(repo.checkItem(id)).toBe(true);
      expect(itemOf(id)?.checkedStoreId).toBeNull();
      expect(repo.currentSession("other")?.storeId).toBeNull();
    });

    it("別のリストのチェックがあっても、このリストの最初のチェックで店舗を聞く", () => {
      repo.setDirection("list", "desc");
      store.commitNow([
        {
          action: "put",
          table: "items",
          row: { ...itemRow("elsewhere", "other"), checked: true, checkedAt: new Date(clock).toISOString() },
        },
      ]);
      expect(repo.checkItem(addTo("list", "品物"))).toBe(true);
    });

    it("別のリストの向きを引き継がない", () => {
      repo.setDirection("list", "desc");
      expect(repo.currentSession("other")).toBeNull();
      repo.setDirection("other", "asc");
      expect(repo.currentSession("other")?.direction.direction).toBe("asc");
      expect(repo.currentSession("list")).toBeNull();
    });

    it("店舗を替えても、別のリストのチェックを付け替えない", () => {
      const [first, second] = [repo.addStore("list", "店1", null), repo.addStore("list", "店2", null)];
      const elsewhere: Item = { ...itemRow("elsewhere", "other"), checked: true, checkedAt: new Date(clock).toISOString(), checkedStoreId: first };
      store.commitNow([{ action: "put", table: "items", row: elsewhere }]);
      repo.selectStore("list", first);
      repo.selectStore("list", second);
      expect(itemOf("elsewhere")?.checkedStoreId).toBe(first);
    });

    it("listId の無い保存済みの状態は無視する", () => {
      const at = new Date(clock).toISOString();
      store.setSetting("shoppingSession", JSON.stringify({ storeId: "x", startedAt: at, touchedAt: at, direction: {} }));
      expect(repo.session()).toBeNull();
      expect(repo.currentSession("list")).toBeNull();
      expect(repo.isShopping()).toBe(false);
    });

    it("近くの店で始めると、トリップの最初のチェックで店舗を聞かない", () => {
      const storeId = repo.addStore("list", "店", null);
      const id = addTo("list", "品物");
      repo.selectStore("list", storeId);
      expect(repo.checkItem(id)).toBe(false);
      expect(itemOf(id)?.checkedStoreId).toBe(storeId);
    });
  });
});
