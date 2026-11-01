import { describe, expect, it } from "vitest";
import { FREQUENT_HALF_LIFE_DAYS } from "./constants.ts";
import { frequentItems, itemSuggestions } from "./frequent.ts";
import { historyFixture, itemFixture } from "./test-support.ts";
import type { HistoryEntry } from "./types.ts";

const NOW = "2030-06-01T00:00:00.000Z";

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
}

function bought(name: string, days: number, listId = "list-a", id = 0): HistoryEntry {
  return historyFixture({ id: `h-${name}-${days}-${id}`, name, listId, checkedAt: daysAgo(days) });
}

describe("frequentItems", () => {
  it("回数と新しさの重みを掛けたスコアで並べる", () => {
    const halfLife = FREQUENT_HALF_LIFE_DAYS;
    const history = [
      bought("古い品", halfLife * 3),
      bought("古い品", halfLife * 3, "list-a", 1),
      bought("古い品", halfLife * 3, "list-a", 2),
      bought("新しい品", 0),
    ];
    const result = frequentItems({ listId: "list-a", history, items: [], now: NOW });
    expect(result.map((item) => item.name)).toEqual(["新しい品", "古い品"]);
    expect(result[0].score).toBeCloseTo(1);
    expect(result[1].count).toBe(3);
    expect(result[1].score).toBeCloseTo(3 / 8);
  });

  it("表記の揺れをまとめ、新しい表記を出す", () => {
    const history = [bought("タマゴ", 5), bought("たまご", 1)];
    const [item] = frequentItems({ listId: "list-a", history, items: [], now: NOW });
    expect(item).toMatchObject({ name: "たまご", count: 2 });
  });

  it("そのリストの履歴だけを数え、今リストにある品目を除く", () => {
    const history = [bought("牛乳", 1), bought("豆腐", 1), bought("納豆", 1, "list-b")];
    const items = [itemFixture({ name: "ギュウニュウ" }), itemFixture({ name: "牛乳" })];
    const result = frequentItems({ listId: "list-a", history, items, now: NOW });
    expect(result.map((item) => item.name)).toEqual(["豆腐"]);
  });

  it("ほかのリストにある品目は除かない", () => {
    const history = [bought("牛乳", 1)];
    const items = [itemFixture({ listId: "list-b", name: "牛乳" })];
    expect(frequentItems({ listId: "list-a", history, items, now: NOW })).toHaveLength(1);
  });

  it("同点は決まった順で、数を limit で切る", () => {
    const history = [bought("c", 1), bought("a", 1), bought("b", 1)];
    const result = frequentItems({ listId: "list-a", history, items: [], now: NOW, limit: 2 });
    expect(result.map((item) => item.name)).toEqual(["a", "b"]);
  });
});

describe("itemSuggestions", () => {
  it("そのリストを先に出し、足りない分をほかのリストから足す", () => {
    const history = [
      bought("たまねぎ", 1),
      bought("たまご", 1, "list-b"),
      bought("たまご", 1, "list-b", 1),
      bought("たまねぎ", 1, "list-b"),
      bought("牛乳", 1),
    ];
    const result = itemSuggestions({
      query: "タマ",
      listId: "list-a",
      history,
      items: [],
      now: NOW,
    });
    expect(result.map(({ name, origin }) => [name, origin])).toEqual([
      ["たまねぎ", "list"],
      ["たまご", "otherList"],
    ]);
  });

  it("そのリストで足りればほかのリストを見ない", () => {
    const history = [bought("たまご", 1), bought("たまねぎ", 1, "list-b")];
    const result = itemSuggestions({
      query: "たま",
      listId: "list-a",
      history,
      items: [],
      now: NOW,
      limit: 1,
    });
    expect(result.map((item) => item.name)).toEqual(["たまご"]);
  });

  it("今リストにある品目と空の入力は候補にしない", () => {
    const history = [bought("たまご", 1, "list-b")];
    const items = [itemFixture({ name: "たまご" })];
    const input = { listId: "list-a", history, items, now: NOW };
    expect(itemSuggestions({ ...input, query: "たま" })).toEqual([]);
    expect(itemSuggestions({ ...input, items: [], query: "  " })).toEqual([]);
  });
});
