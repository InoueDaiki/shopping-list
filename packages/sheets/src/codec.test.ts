import type { HistoryEntry, Item, ShoppingList, Store, StoreOrder } from "@shopping-list/core";
import { describe, expect, it } from "vitest";

import type { Cell } from "./client.ts";
import { decodeRow, encodeRow } from "./codec.ts";
import { TABLE_SHEETS, columnLetter, dataRange } from "./schema.ts";

const AT = "2026-01-01T00:00:00.000Z";

const item: Item = {
  id: "item_1",
  listId: "list_1",
  name: "=1+1",
  categoryId: "cat_1",
  categorySource: "user",
  memo: "メモ",
  checked: true,
  checkedAt: AT,
  checkedStoreId: "store_1",
  updatedAt: AT,
};

// シートの返す形にする。空の値は null で返らず、空文字か省略になる
const asRead = (cells: Cell[]) => cells.map((cell) => (cell === null ? "" : cell));

describe("codec", () => {
  it("品目を往復できる", () => {
    const decoded = decodeRow("items", asRead(encodeRow("items", item)), 2);
    expect(decoded).toEqual({ kind: "row", row: item, deletedAt: null });
  });

  it("空の値は null に戻す", () => {
    const row: Item = {
      ...item,
      categoryId: null,
      categorySource: null,
      memo: "",
      checked: false,
      checkedAt: null,
      checkedStoreId: null,
    };
    expect(decodeRow("items", asRead(encodeRow("items", row)), 2)).toEqual({
      kind: "row",
      row,
      deletedAt: null,
    });
  });

  it("History、店舗、手の順番を往復できる", () => {
    const history: HistoryEntry = {
      id: "h1",
      listId: "l1",
      name: "牛乳",
      categoryId: null,
      categorySource: "user",
      storeId: "s1",
      tripId: "t1",
      checkedAt: AT,
      checkedSeq: 0,
    };
    const store: Store = {
      id: "s1",
      name: "店",
      lat: null,
      lng: null,
      createdAt: AT,
      updatedAt: AT,
    };
    const list: ShoppingList = { id: "l1", name: "スーパー", sort: 1, updatedAt: AT };
    const order: StoreOrder = { storeId: "s1", categoryIds: ["c1", "c2"], editedAt: AT };

    expect(decodeRow("history", asRead(encodeRow("history", history)), 2)).toMatchObject({
      kind: "row",
      row: history,
    });
    expect(decodeRow("stores", asRead(encodeRow("stores", store)), 2)).toMatchObject({
      kind: "row",
      row: store,
    });
    expect(decodeRow("lists", asRead(encodeRow("lists", list)), 2)).toMatchObject({
      kind: "row",
      row: list,
    });
    expect(decodeRow("storeOrders", asRead(encodeRow("storeOrders", order)), 2)).toMatchObject({
      kind: "row",
      row: order,
    });
  });

  it("deleted_at を読み、行全体を書くときは空にする", () => {
    const cells: Cell[] = encodeRow("items", item);
    expect(cells.at(-1)).toBeNull();
    cells[cells.length - 1] = AT;
    expect(decodeRow("items", cells, 2)).toEqual({ kind: "row", row: item, deletedAt: AT });
    cells[cells.length - 1] = "昨日";
    expect(decodeRow("items", cells, 2).kind).toBe("issue");
  });

  it("不正な行は捨てずに、行と列を添えて報告する", () => {
    const cells = encodeRow("items", item);
    cells[4] = "unknown";
    cells[6] = "はい";
    cells[9] = "昨日";
    const decoded = decodeRow("items", cells, 7);

    expect(decoded.kind).toBe("issue");
    if (decoded.kind !== "issue") return;
    expect(decoded.issue).toMatchObject({ table: "items", row: 7, id: "item_1" });
    expect(decoded.issue.problems.map((problem) => problem.column)).toEqual([
      "category_source",
      "checked",
      "updated_at",
    ]);
  });

  it("ID が読めない行は id を null にする", () => {
    const decoded = decodeRow("lists", ["日本語の ID", "スーパー", 1, AT], 3);
    expect(decoded).toMatchObject({ kind: "issue", issue: { id: null, row: 3 } });
  });

  it("空の行は blank にする", () => {
    expect(decodeRow("lists", [], 3)).toEqual({ kind: "blank" });
    expect(decodeRow("lists", ["", ""], 3)).toEqual({ kind: "blank" });
  });

  it("手で入れた数字だけの品目名を文字列に戻す", () => {
    const cells: Cell[] = encodeRow("items", { ...item, name: "x" });
    cells[2] = 100;
    expect(decodeRow("items", cells, 2)).toMatchObject({
      kind: "row",
      row: { name: "100" },
    });
  });

  it("緯度と経度の片方だけ、範囲の外は不正にする", () => {
    expect(decodeRow("stores", ["s1", "店", 35, "", AT, AT], 2).kind).toBe("issue");
    expect(decodeRow("stores", ["s1", "店", 91, 139, AT, AT], 2).kind).toBe("issue");
  });

  it("表の列の数と encode の列の数が合う", () => {
    expect(encodeRow("items", item)).toHaveLength(TABLE_SHEETS.items.columns.length);
  });
});

describe("schema", () => {
  it("範囲の文字列を作る", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(26)).toBe("AA");
    expect(dataRange(TABLE_SHEETS.items)).toBe("Items!A2:K");
    expect(dataRange(TABLE_SHEETS.history, 50)).toBe("History!A50:I");
  });
});
