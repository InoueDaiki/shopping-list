import { describe, expect, it } from "vitest";
import { INFERENCE_DICTIONARY } from "./inference-dictionary.ts";
import { categoriesOfList, initialCategories, listCategoryId, rehomeCategoryIds, rehomeHistory } from "./listCategories.ts";
import { historyFixture } from "./test-support.ts";
import type { Category } from "./types.ts";

// packages/sheets の ID_PATTERN と同じ形(core は sheets に依らないので写す)
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const category = (id: string, listId: string | null, name = id): Category => ({
  id,
  name,
  sort: 1,
  updatedAt: "2028-01-01T00:00:00.000Z",
  listId,
});

describe("listCategoryId", () => {
  it("共通の ID とリストの ID をつなぐ", () => {
    expect(listCategoryId("cat_meat", "list-a")).toBe("cat_meat-list-a");
  });

  it("いちばん長い初期の ID と乱数の ID(21文字)でも ID の形に収まる", () => {
    const listId = "L".repeat(21);
    for (const row of initialCategories(listId)) expect(row.id).toMatch(ID_RE);
    expect(listCategoryId("C".repeat(21), listId)).toMatch(ID_RE);
  });
});

describe("initialCategories", () => {
  it("どの端末でも同じ行になり、ID は共通の初期のカテゴリを分けたときと同じ", () => {
    const rows = initialCategories("list-a");
    expect(rows).toEqual(initialCategories("list-a"));
    expect(rows[1]).toEqual({ id: "cat_meat-list-a", name: "生肉", sort: 2, updatedAt: "2000-01-01T00:00:00.000Z", listId: "list-a" });
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.every((row) => row.listId === "list-a")).toBe(true);
  });

  it("推定の辞書のキーは初期のカテゴリの名前と一致する", () => {
    expect(Object.keys(INFERENCE_DICTIONARY).sort()).toEqual(initialCategories("list-a").map((row) => row.name).sort());
  });

  it("リストが違えば ID も違う", () => {
    const a = new Set(initialCategories("list-a").map((row) => row.id));
    expect(initialCategories("list-b").some((row) => a.has(row.id))).toBe(false);
  });
});

describe("categoriesOfList", () => {
  const categories = [category("a1", "list-a"), category("b1", "list-b"), category("shared", null), category("a2", "list-a")];

  it("そのリストのカテゴリだけを、元の順で返す", () => {
    expect(categoriesOfList(categories, "list-a").map((row) => row.id)).toEqual(["a1", "a2"]);
    expect(categoriesOfList(categories, "list-c")).toEqual([]);
  });

  it("null は共通のカテゴリ(移行の途中)", () => {
    expect(categoriesOfList(categories, null).map((row) => row.id)).toEqual(["shared"]);
  });

  it("同じマスタの配列なら同じ配列を返す", () => {
    expect(categoriesOfList(categories, "list-a")).toBe(categoriesOfList(categories, "list-a"));
    expect(categoriesOfList([...categories], "list-a")).not.toBe(categoriesOfList(categories, "list-a"));
  });
});

describe("rehomeHistory", () => {
  const categories = [category("cat_meat-list-a", "list-a"), category("cat_meat-list-b", "list-b"), category("own", "list-a")];

  it("今のカテゴリに無い ID を、その履歴のリストのカテゴリの ID に読み替える", () => {
    const history = [
      historyFixture({ id: "h1", listId: "list-a", categoryId: "cat_meat" }),
      historyFixture({ id: "h2", listId: "list-b", categoryId: "cat_meat" }),
    ];
    expect(rehomeHistory(history, categories).map((row) => row.categoryId)).toEqual(["cat_meat-list-a", "cat_meat-list-b"]);
    // 元の行は書き換えない
    expect(history[0].categoryId).toBe("cat_meat");
  });

  it("変わらない行は同じオブジェクトを返す", () => {
    const history = [
      historyFixture({ id: "h1", categoryId: "cat_meat" }),
      historyFixture({ id: "h2", categoryId: "own" }),
      historyFixture({ id: "h3", categoryId: null }),
      // 分けた先がそのリストに無い
      historyFixture({ id: "h4", listId: "list-c", categoryId: "cat_meat" }),
      historyFixture({ id: "h5", categoryId: "cat_gone" }),
    ];
    const rehomed = rehomeHistory(history, categories);
    expect(rehomed).not.toBe(history);
    expect(rehomed[0]).not.toBe(history[0]);
    for (const index of [1, 2, 3, 4]) expect(rehomed[index]).toBe(history[index]);
  });

  it("1行も変わらなければ同じ配列を返す", () => {
    const history = [historyFixture({ id: "h1", categoryId: "own" }), historyFixture({ id: "h2", categoryId: null })];
    expect(rehomeHistory(history, categories)).toBe(history);
    const empty: never[] = [];
    expect(rehomeHistory(empty, categories)).toBe(empty);
  });

  it("共通のカテゴリがまだあれば(分ける前)読み替えない", () => {
    const history = [historyFixture({ categoryId: "cat_meat" })];
    expect(rehomeHistory(history, [...categories, category("cat_meat", null)])).toBe(history);
  });
});

describe("rehomeCategoryIds", () => {
  const categories = [category("cat_meat-list-a", "list-a"), category("cat_fish-list-a", "list-a"), category("cat_meat-list-b", "list-b")];

  it("手の順番の ID を、渡したリストのカテゴリの ID に読み替える", () => {
    expect(rehomeCategoryIds(["cat_fish", "cat_meat", "cat_gone"], "list-a", categories)).toEqual([
      "cat_fish-list-a",
      "cat_meat-list-a",
      "cat_gone",
    ]);
    expect(rehomeCategoryIds(["cat_fish", "cat_meat"], "list-b", categories)).toEqual(["cat_fish", "cat_meat-list-b"]);
  });

  it("1つも変わらなければ同じ配列を返す", () => {
    const ids = ["cat_meat-list-a", "cat_fish-list-a"];
    expect(rehomeCategoryIds(ids, "list-a", categories)).toBe(ids);
  });
});
