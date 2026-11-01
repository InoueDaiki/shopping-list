import { HOUR_MS, TRIP_GAP_MS, type Id } from "@shopping-list/core";
import { beforeEach, describe, expect, it } from "vitest";

import { SqliteLocalStore } from "./localStore.ts";
import { Repository } from "./repository.ts";
import { openTestDatabase } from "./testDb.ts";

const START = Date.parse("2028-01-01T00:00:00.000Z");
const NONE = { categoryId: null, categorySource: null };
const CATEGORIES: Id[] = ["a", "b", "c"];

describe("Repository", () => {
  let store: SqliteLocalStore;
  let repo: Repository;
  let clock: number;
  let order: readonly Id[];
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
      orderForStore: () => order,
    });
  });

  const add = (name: string, categoryId: Id | null = null) =>
    repo.addItem("list", name, categoryId ? { categoryId, categorySource: "history" } : NONE);
  const itemOf = (id: Id) => store.rows("items").find((row) => row.id === id);

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

  it("カテゴリを直すと user になり、名前だけなら元のまま", () => {
    const item = add("品物", "a");
    repo.updateItem(item?.id ?? "", { name: "新しい名前" });
    expect(itemOf(item?.id ?? "")?.categorySource).toBe("history");
    repo.updateItem(item?.id ?? "", { categoryId: "b" });
    expect(itemOf(item?.id ?? "")).toMatchObject({ categoryId: "b", categorySource: "user" });
  });

  it("最初のチェックだけ店舗を聞き、選ぶとチェックに店舗が付く", () => {
    const [a, b] = [add("品物1"), add("品物2")];
    expect(repo.checkItem(a?.id ?? "")).toBe(true);
    expect(itemOf(a?.id ?? "")?.checkedStoreId).toBeNull();
    const storeId = repo.addStore("架空の店", null);
    repo.selectStore(storeId);
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
    repo.setDirection("desc");
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
    const [first, second] = [repo.addStore("店1", null), repo.addStore("店2", null)];
    repo.selectStore(first);
    repo.selectStore(second);
    expect(itemOf(item?.id ?? "")?.checkedStoreId).toBe(second);
  });

  it("チェックを外すと記録も消える", () => {
    const item = add("品物");
    repo.checkItem(item?.id ?? "");
    repo.uncheckItem(item?.id ?? "");
    expect(itemOf(item?.id ?? "")).toMatchObject({ checked: false, checkedAt: null, checkedStoreId: null });
  });

  it("逆回りのチェックが3カテゴリに届くと、自動で降順にする", () => {
    const storeId = repo.addStore("架空の店", null);
    repo.selectStore(storeId);
    for (const categoryId of ["c", "b", "a"]) {
      clock += 60_000;
      repo.checkItem(add(`品物${categoryId}`, categoryId)?.id ?? "");
    }
    expect(repo.currentSession()?.direction).toMatchObject({ direction: "desc", autoSwitched: true });
  });

  it("手で向きを切り替えたら、そのトリップでは自動で切り替えない", () => {
    const storeId = repo.addStore("架空の店", null);
    repo.selectStore(storeId);
    repo.setDirection("asc");
    for (const categoryId of ["c", "b", "a"]) {
      clock += 60_000;
      repo.checkItem(add(`品物${categoryId}`, categoryId)?.id ?? "");
    }
    expect(repo.currentSession()?.direction.direction).toBe("asc");
  });

  it("終わったトリップを History へ移す。店舗の無いチェックも移す", () => {
    const [a, b, open] = [add("品物1", "a"), add("品物2", "b"), add("未チェック")];
    const storeId = repo.addStore("架空の店", null);
    repo.selectStore(storeId);
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
    const storeId = repo.addStore("架空の店", null);
    repo.checkItem(item?.id ?? "");
    repo.selectStore(storeId);
    repo.saveStoreOrder(storeId, ["a"]);
    repo.deleteStore(storeId);
    expect(store.rows("storeOrders")).toEqual([]);
    expect(itemOf(item?.id ?? "")?.checkedStoreId).toBeNull();
    expect(repo.currentSession()?.storeId).toBeNull();
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
    expect(repo.currentSession()).toBeNull();
  });
});
