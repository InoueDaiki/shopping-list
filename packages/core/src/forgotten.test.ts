import { describe, expect, it } from "vitest";

import { lookupCategory } from "./category.ts";
import { filterRegisteredItems, registeredItems, withoutForgotten } from "./forgotten.ts";
import { frequentItems, itemSuggestions } from "./frequent.ts";
import { createCategoryInferrer } from "./inference.ts";
import { categoriesFixture, historyFixture } from "./test-support.ts";
import type { ForgottenItem, HistoryEntry } from "./types.ts";

const NOW = "2030-06-01T00:00:00.000Z";

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
}

function bought(name: string, days: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return historyFixture({ id: `h-${name}-${days}-${overrides.listId ?? "a"}`, name, checkedAt: daysAgo(days), ...overrides });
}

function forgot(normalizedName: string, days: number, overrides: Partial<ForgottenItem> = {}): ForgottenItem {
  return {
    id: `f-${normalizedName}-${days}`,
    listId: "list-a",
    normalizedName,
    forgottenAt: daysAgo(days),
    updatedAt: daysAgo(days),
    ...overrides,
  };
}

describe("withoutForgotten", () => {
  it("同じリストで、名前が同じで、忘れた時刻までに買った記録を除く", () => {
    const history = [bought("ギュウニュウ", 3), bought("牛乳", 3), bought("ぎゅうにゅう", 2, { listId: "list-b" })];
    const kept = withoutForgotten(history, [forgot("ぎゅうにゅう", 1)]);
    expect(kept.map((entry) => entry.id)).toEqual(["h-牛乳-3-a", "h-ぎゅうにゅう-2-list-b"]);
  });

  it("忘れた後にまた買った分は残す", () => {
    const history = [bought("豆腐", 5), bought("豆腐", 1)];
    expect(withoutForgotten(history, [forgot("豆腐", 3)]).map((entry) => entry.checkedAt)).toEqual([daysAgo(1)]);
  });

  it("同じ名前を2回忘れたら、新しいほうの時刻まで除く", () => {
    const history = [bought("豆腐", 5), bought("豆腐", 2)];
    const forgotten = [forgot("豆腐", 4), forgot("豆腐", 1, { id: "f-other" })];
    expect(withoutForgotten(history, forgotten)).toEqual([]);
  });

  it("除くものが無ければ同じ配列を返す", () => {
    const history = [bought("豆腐", 5)];
    expect(withoutForgotten(history, [])).toBe(history);
    expect(withoutForgotten(history, [forgot("納豆", 1)])).toBe(history);
  });

  it("候補、よく使う品目、カテゴリの引き当てに出なくなる", () => {
    const history = [
      bought("とまとう", 2, { categoryId: "cat-fish", categorySource: "user" }),
      bought("トマト", 1, { id: "h-tomato", categoryId: "cat-dairy" }),
    ];
    const kept = withoutForgotten(history, [forgot("とまとう", 1)]);
    const input = { listId: "list-a", history: kept, items: [], now: NOW };
    expect(itemSuggestions({ ...input, query: "とま" }).map((item) => item.name)).toEqual(["トマト"]);
    expect(frequentItems(input).map((item) => item.name)).toEqual(["トマト"]);
    expect(
      lookupCategory({ name: "とまとう", listId: "list-a", categories: categoriesFixture, items: [], history: kept }),
    ).toEqual({ categoryId: null, categorySource: null });
  });

  it("推定の学習にも使わない", async () => {
    const history = ["ぴよぴよ", "ぴよぴよ汁", "ぴよぴよ焼き"].map((name, index) =>
      bought(name, 2 + index, { categoryId: "cat-fish" }),
    );
    const remembered = createCategoryInferrer(() => history);
    expect(await remembered.infer("ぴよぴよ煮", categoriesFixture)).toBe("cat-fish");
    const forgotten = ["ぴよぴよ", "ぴよぴよ汁", "ぴよぴよ焼き"].map((name) => forgot(name, 1));
    const inferrer = createCategoryInferrer(() => withoutForgotten(history, forgotten));
    expect(await inferrer.infer("ぴよぴよ煮", categoriesFixture)).toBeNull();
  });
});

describe("registeredItems", () => {
  it("そのリストの品目を名前ごとにまとめ、最後に買った日の新しい順に返す", () => {
    const history = [
      bought("タマゴ", 9, { categoryId: "cat-dairy" }),
      bought("たまご", 2, { categoryId: "cat-fish" }),
      bought("牛乳", 5),
      bought("納豆", 1, { listId: "list-b" }),
    ];
    expect(registeredItems({ listId: "list-a", history })).toEqual([
      { name: "たまご", normalizedName: "たまご", categoryId: "cat-fish", count: 2, lastCheckedAt: daysAgo(2) },
      { name: "牛乳", normalizedName: "牛乳", categoryId: null, count: 1, lastCheckedAt: daysAgo(5) },
    ]);
  });

  it("検索は表記の揺れをそろえて、名前の一部で絞る", () => {
    const items = registeredItems({ listId: "list-a", history: [bought("トマト", 1), bought("牛乳", 2)] });
    expect(filterRegisteredItems(items, " とま ").map((item) => item.name)).toEqual(["トマト"]);
    expect(filterRegisteredItems(items, "")).toBe(items);
  });
});
