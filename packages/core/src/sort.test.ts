import { describe, expect, it } from "vitest";
import { sectionItems } from "./sort.ts";
import { itemFixture } from "./test-support.ts";

const order = ["cat-a", "cat-b", "cat-c"];

const items = [
  itemFixture({ id: "1", name: "ばなな", categoryId: "cat-b" }),
  itemFixture({ id: "2", name: "あんず", categoryId: "cat-b" }),
  itemFixture({ id: "3", name: "牛乳", categoryId: "cat-a" }),
  itemFixture({ id: "4", name: "未分類の品", categoryId: null }),
  itemFixture({ id: "5", name: "消えた売り場の品", categoryId: "cat-gone" }),
  itemFixture({ id: "6", name: "買った品", categoryId: "cat-c", checked: true }),
  itemFixture({ id: "7", name: "買った肉", categoryId: "cat-a", checked: true }),
];

function shape(sections: ReturnType<typeof sectionItems>["unchecked"]) {
  return sections.map(({ categoryId, items: list }) => [categoryId, list.map(({ id }) => id)]);
}

describe("sectionItems", () => {
  it("昇順では順番どおりに並べ、未チェックとチェック済みを分ける", () => {
    const result = sectionItems({ items, order, direction: "asc" });
    expect(shape(result.unchecked)).toEqual([
      ["cat-a", ["3"]],
      ["cat-b", ["2", "1"]],
      [null, ["4", "5"]],
    ]);
    expect(shape(result.checked)).toEqual([
      ["cat-a", ["7"]],
      ["cat-c", ["6"]],
    ]);
  });

  it("降順では逆に並べ、未分類は最後のまま", () => {
    const result = sectionItems({ items, order, direction: "desc" });
    expect(result.unchecked.map((section) => section.categoryId)).toEqual([
      "cat-b",
      "cat-a",
      null,
    ]);
    expect(result.checked.map((section) => section.categoryId)).toEqual(["cat-c", "cat-a"]);
  });

  it("渡した順番を変えない", () => {
    const input = [...order];
    sectionItems({ items, order: input, direction: "desc" });
    expect(input).toEqual(order);
  });
});
