import type { Category, Id, Store, StoreOrder } from "@shopping-list/core";
import { describe, expect, it } from "vitest";

import { OrderCache, type OrderSources } from "./ordering.ts";

const AT = "2028-01-01T00:00:00.000Z";

const category = (id: Id, listId: Id | null, sort: number): Category => ({ id, name: id, sort, updatedAt: AT, listId });
const store = (id: Id, listId: Id | null): Store => ({ id, name: id, lat: null, lng: null, createdAt: AT, updatedAt: AT, listId });

const categories = [
  category("cat_fish-a", "a", 1),
  category("cat_meat-a", "a", 2),
  category("cat_fish-b", "b", 1),
  category("cat_soap-b", "b", 2),
];
const stores = [store("store-a", "a"), store("store-free", null)];

function sources(storeOrders: StoreOrder[] = []): OrderSources {
  return { categories, stores, history: [], storeOrders, now: AT };
}

describe("OrderCache", () => {
  it("店舗が決まっていなければ、開いているリストのカテゴリをマスタの順で返す", () => {
    const cache = new OrderCache();
    const input = sources();
    expect(cache.orderFor(null, "a", input)).toEqual(["cat_fish-a", "cat_meat-a"]);
    expect(cache.orderFor(null, "b", input)).toEqual(["cat_fish-b", "cat_soap-b"]);
  });

  it("店舗の順番に出るのは、その店舗のリストのカテゴリだけ", () => {
    const cache = new OrderCache();
    const input = sources([{ storeId: "store-a", categoryIds: ["cat_meat-a", "cat_fish-b", "cat_fish-a"], editedAt: AT }]);
    // 開いているリストが違っても、店舗のリストで決まる
    expect(cache.orderFor("store-a", "b", input)).toEqual(["cat_meat-a", "cat_fish-a"]);
  });

  it("リストの決まっていない店舗は、開いているリストのカテゴリにする", () => {
    const cache = new OrderCache();
    const input = sources();
    expect(cache.orderFor("store-free", "a", input)).toEqual(["cat_fish-a", "cat_meat-a"]);
    expect(cache.orderFor("store-free", "b", input)).toEqual(["cat_fish-b", "cat_soap-b"]);
  });

  it("共通だったころの ID の手の順番を、そのリストのカテゴリとして読む", () => {
    const cache = new OrderCache();
    const input = sources([{ storeId: "store-free", categoryIds: ["cat_meat", "cat_soap", "cat_fish"], editedAt: AT }]);
    expect(cache.orderFor("store-free", "a", input)).toEqual(["cat_meat-a", "cat_fish-a"]);
    expect(cache.orderFor("store-free", "b", input)).toEqual(["cat_soap-b", "cat_fish-b"]);
    expect(cache.learnedOrderFor("store-free", "a", input)).toEqual(["cat_meat-a", "cat_fish-a"]);
  });

  it("元の表が変わるまで同じ配列を返す", () => {
    const cache = new OrderCache();
    const input = sources();
    const first = cache.orderFor("store-a", "a", input);
    expect(cache.orderFor("store-a", "a", { ...input, now: "2028-01-02T00:00:00.000Z" })).toBe(first);
    expect(cache.orderFor("store-a", "a", { ...input, stores: [...stores] })).not.toBe(first);
  });

  it("学んでいない店舗の学んだ順番は null", () => {
    expect(new OrderCache().learnedOrderFor("store-a", "a", sources())).toBeNull();
  });
});
