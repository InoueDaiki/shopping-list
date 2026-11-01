// テストだけで使う、架空のデータの部品
import type { Category, HistoryEntry, Item, Store } from "./types.ts";

export const categoriesFixture: Category[] = [
  { id: "cat-fish", name: "鮮魚", sort: 1 },
  { id: "cat-meat", name: "生肉", sort: 2 },
  { id: "cat-dairy", name: "乳製品", sort: 3 },
];

export function itemFixture(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    listId: "list-a",
    name: "たまご",
    categoryId: null,
    categorySource: null,
    memo: "",
    checked: false,
    checkedAt: null,
    checkedStoreId: null,
    updatedAt: "2028-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function historyFixture(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "history-1",
    listId: "list-a",
    name: "たまご",
    categoryId: null,
    storeId: null,
    tripId: null,
    checkedAt: "2028-01-01T00:00:00.000Z",
    checkedSeq: 0,
    ...overrides,
  };
}

export function storeFixture(overrides: Partial<Store> = {}): Store {
  return {
    id: "store-1",
    name: "架空の店",
    lat: null,
    lng: null,
    createdAt: "2028-01-01T00:00:00.000Z",
    ...overrides,
  };
}
