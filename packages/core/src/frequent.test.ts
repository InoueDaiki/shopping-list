import { describe, expect, it } from "vitest";
import { FREQUENT_HALF_LIFE_DAYS } from "./constants.ts";
import { crossListSuggestions, frequentItems, itemSuggestions } from "./frequent.ts";
import { historyFixture, itemFixture } from "./test-support.ts";
import type { ForgottenItem, HistoryEntry, ShoppingList } from "./types.ts";

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

describe("crossListSuggestions", () => {
  const list = (id: string, sort: number): ShoppingList => ({ id, name: id, sort, updatedAt: NOW });
  const lists = [list("list-a", 1), list("list-b", 2)];
  const base = { lists, forgotten: [], items: [], now: NOW };

  it("同じ名前をリストごとに別の候補にし、リストをまたいでスコアの高い順に並べる", () => {
    const history = [
      bought("牛乳", 1),
      bought("牛乳", 1, "list-b"),
      bought("牛乳", 2, "list-b", 1),
      bought("ぎゅうにく", 0),
      bought("豆腐", 0),
    ];
    expect(crossListSuggestions({ ...base, query: "牛", history }).map(({ name, listId, count }) => [name, listId, count])).toEqual([
      ["牛乳", "list-b", 2],
      ["牛乳", "list-a", 1],
    ]);
    // 照合は正規化した名前の部分一致(カタカナはひらがなにそろう)
    expect(crossListSuggestions({ ...base, query: "ギュウ", history }).map((item) => item.name)).toEqual(["ぎゅうにく"]);
  });

  it("同点は名前、リストの sort の順にし、limit で切る", () => {
    const history = [bought("たまご", 1, "list-b"), bought("たまご", 1), bought("たまねぎ", 1, "list-b")];
    const reordered = [list("list-a", 5), list("list-b", 2)];
    const result = crossListSuggestions({ ...base, lists: reordered, query: "たま", history });
    expect(result.map(({ name, listId }) => [name, listId])).toEqual([
      ["たまご", "list-b"],
      ["たまご", "list-a"],
      ["たまねぎ", "list-b"],
    ]);
    expect(crossListSuggestions({ ...base, query: "たま", history, limit: 1 })).toHaveLength(1);
  });

  it("消したリストの履歴は出さない", () => {
    const history = [bought("たまご", 1, "list-gone"), bought("たまご", 3)];
    expect(crossListSuggestions({ ...base, query: "たま", history }).map((item) => item.listId)).toEqual(["list-a"]);
  });

  it("そのリストで忘れた名前は、そのリストの候補からだけ除く。忘れた後に買った分は出る", () => {
    const history = [bought("たまご", 5), bought("たまご", 5, "list-b"), bought("たまねぎ", 5)];
    const forgotten: ForgottenItem[] = [
      { id: "f1", listId: "list-a", normalizedName: "たまご", forgottenAt: daysAgo(2), updatedAt: daysAgo(2) },
    ];
    const input = { ...base, query: "たま", forgotten };
    expect(crossListSuggestions({ ...input, history }).map(({ name, listId }) => [name, listId])).toEqual([
      ["たまご", "list-b"],
      ["たまねぎ", "list-a"],
    ]);
    const again = [...history, bought("タマゴ", 1)];
    expect(crossListSuggestions({ ...input, history: again }).map(({ name, listId }) => [name, listId])).toEqual([
      ["タマゴ", "list-a"],
      ["たまご", "list-b"],
      ["たまねぎ", "list-a"],
    ]);
  });

  it("今そのリストにある品目は、そのリストの候補からだけ除く。リストの無い品目では除かない", () => {
    const history = [bought("たまご", 1), bought("たまご", 1, "list-b")];
    const items = [itemFixture({ name: "タマゴ", checked: true }), itemFixture({ id: "stray", listId: null, name: "たまご" })];
    expect(crossListSuggestions({ ...base, query: "たま", history, items }).map((item) => item.listId)).toEqual(["list-b"]);
  });

  it("空の入力は候補にしない", () => {
    expect(crossListSuggestions({ ...base, query: " ", history: [bought("たまご", 1)] })).toEqual([]);
  });
});
