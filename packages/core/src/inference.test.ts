import { describe, expect, it } from "vitest";
import { lookupCategory, resolveCategory } from "./category.ts";
import { INFERENCE_DICTIONARY } from "./inference-dictionary.ts";
import { createCategoryInferrer, type InferenceRecords } from "./inference.ts";
import { normalizeItemName } from "./normalize.ts";
import { historyFixture, itemFixture } from "./test-support.ts";
import type { Category, HistoryEntry } from "./types.ts";

function category(id: string, name: string): Category {
  return { id, name, sort: 1, updatedAt: "2028-01-01T00:00:00.000Z" };
}

const master = Object.keys(INFERENCE_DICTIONARY).map((name, index) => category(`cat-${index}`, name));
const idOf = (name: string) => master.find((row) => row.name === name)?.id;
const noRecords: InferenceRecords = { items: [], history: [] };
const dictionaryOnly = createCategoryInferrer(() => noRecords);

function learned(categoryId: string, names: readonly string[], source: HistoryEntry["categorySource"] = "user") {
  return names.map((name, index) =>
    historyFixture({ id: `${categoryId}-${index}`, name, categoryId, categorySource: source }),
  );
}

// 辞書に無い架空の語で、履歴だけを見る
const WIDGET = category("cat-widget", "架空の部品");
const GADGET = category("cat-gadget", "架空の機器");
const widgets = learned(WIDGET.id, ["ねじ大", "ねじ中", "ねじ小", "ねじ長", "ねじ短"]);
const gadgets = learned(GADGET.id, ["歯車大", "歯車中", "歯車小", "歯車長", "歯車短"]);

describe("組み込みの語彙の辞書", () => {
  const words = Object.values(INFERENCE_DICTIONARY).flat();

  it("語は 800 から 1500 の範囲にある", () => {
    expect(words.length).toBeGreaterThanOrEqual(800);
    expect(words.length).toBeLessThanOrEqual(1500);
  });

  it("正規化しても同じ語が重ならない", () => {
    const keys = words.map(normalizeItemName);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });

  it.each([
    ["鶏もも肉", "生肉"],
    ["牛乳", "乳製品"],
    ["たまご", "卵"],
    ["木綿豆腐", "豆腐・納豆"],
    ["食パン", "パン"],
    ["トイレットペーパー", "日用品"],
    ["風邪薬", "医薬品"],
  ])("完全一致で引く: %s", async (name, expected) => {
    expect(await dictionaryOnly.infer(name, master)).toBe(idOf(expected));
  });

  it.each([
    ["国産鶏もも肉", "生肉"],
    ["低脂肪牛乳", "乳製品"],
    ["ノルウェーサーモン", "鮮魚"],
    ["北海道産じゃがいも", "野菜"],
    ["徳用トイレットペーパー", "日用品"],
  ])("部分一致で引く: %s", async (name, expected) => {
    expect(await dictionaryOnly.infer(name, master)).toBe(idOf(expected));
  });

  it.each([
    ["トマト缶", "調味料"],
    ["徳用トマト缶", "調味料"],
    ["いちごジャム", "調味料"],
    ["トマトジュース", "飲料"],
    ["酒粕", "調味料"],
  ])("最長の語を取る: %s", async (name, expected) => {
    expect(await dictionaryOnly.infer(name, master)).toBe(idOf(expected));
  });

  it("同じ長さの語なら後ろの語を取る", async () => {
    expect(await dictionaryOnly.infer("豚肉豆腐", master)).toBe(idOf("豆腐・納豆"));
  });

  it("ひらがな、カタカナ、半角の揺れをそろえる", async () => {
    const expected = idOf("果物");
    expect(await dictionaryOnly.infer("バナナ", master)).toBe(expected);
    expect(await dictionaryOnly.infer("ばなな", master)).toBe(expected);
    expect(await dictionaryOnly.infer("ﾊﾞﾅﾅ", master)).toBe(expected);
  });

  it("短い語は部分一致に使わない", async () => {
    expect(await dictionaryOnly.infer("ふともも", master)).toBeNull();
    expect(await dictionaryOnly.infer("架空の酒", master)).toBeNull();
  });

  it("知らない語と空の名前は null", async () => {
    expect(await dictionaryOnly.infer("架空の品物", master)).toBeNull();
    expect(await dictionaryOnly.infer("  ", master)).toBeNull();
  });

  it("名前を変えたカテゴリと消したカテゴリは候補にしない", async () => {
    const renamed = master.map((row) => (row.name === "乳製品" ? { ...row, name: "冷蔵" } : row));
    expect(await dictionaryOnly.infer("牛乳", renamed)).toBeNull();
    const removed = master.filter((row) => row.name !== "乳製品");
    expect(await dictionaryOnly.infer("牛乳", removed)).toBeNull();
  });

  it("長い語のカテゴリが消えていれば、短い語のカテゴリを取る", async () => {
    const removed = master.filter((row) => row.name !== "調味料");
    expect(await dictionaryOnly.infer("トマト缶", removed)).toBe(idOf("野菜"));
  });

  it("カテゴリの名前もひらがなとカタカナの違いをそろえて突き合わせる", async () => {
    const custom = category("cat-bread", "ぱん");
    expect(await dictionaryOnly.infer("食パン", [custom])).toBe("cat-bread");
  });
});

describe("履歴で学ぶ Naive Bayes", () => {
  const categories = [WIDGET, GADGET];
  const inferrerOf = (history: readonly HistoryEntry[], items: InferenceRecords["items"] = []) =>
    createCategoryInferrer(() => ({ items, history }));

  it("似た名前の品目から決める", async () => {
    const inferrer = inferrerOf([...widgets, ...gadgets]);
    expect(await inferrer.infer("ねじ特大", categories)).toBe(WIDGET.id);
    expect(await inferrer.infer("歯車特大", categories)).toBe(GADGET.id);
  });

  it("今の品目からも学ぶ", async () => {
    const items = widgets.map((entry) =>
      itemFixture({ id: entry.id, name: entry.name, categoryId: entry.categoryId, categorySource: "history" }),
    );
    expect(await inferrerOf(gadgets, items).infer("ねじ特大", categories)).toBe(WIDGET.id);
  });

  it("推定で入った記録からは学ばない", async () => {
    const history = learned(WIDGET.id, ["ねじ大", "ねじ中", "ねじ小"], "inferred");
    expect(await inferrerOf([...history, ...gadgets]).infer("ねじ特大", categories)).toBeNull();
  });

  it("学習の少ないカテゴリからは答えない", async () => {
    const few = learned(WIDGET.id, ["ねじ大", "ねじ中"]);
    expect(await inferrerOf([...few, ...gadgets]).infer("ねじ特大", categories)).toBeNull();
  });

  it("同じ名前を何度買っても学習の数に数えない", async () => {
    const repeated = learned(WIDGET.id, ["ねじ大", "ねじ大", "ねじ大", "ねじ大"]);
    expect(await inferrerOf([...repeated, ...gadgets]).infer("ねじ特大", categories)).toBeNull();
  });

  it("名前の一部が似ているだけなら答えない", async () => {
    const inferrer = inferrerOf([...widgets, ...gadgets]);
    expect(await inferrer.infer("ねじまわし用の架空の持ち手", categories)).toBeNull();
    expect(await inferrer.infer("無関係の名前", categories)).toBeNull();
  });

  it("マスタから消えたカテゴリは候補にしない", async () => {
    const inferrer = inferrerOf([...widgets, ...gadgets]);
    expect(await inferrer.infer("ねじ特大", [GADGET])).toBeNull();
  });

  it("確信があれば辞書より履歴を使う", async () => {
    const mine = category("cat-mine", "架空の売り場");
    const dairy = category("cat-dairy", "乳製品");
    const history = learned(mine.id, ["低脂肪牛乳", "特濃牛乳", "成分調整牛乳", "牛乳1本", "牛乳2本"]);
    expect(await inferrerOf(history).infer("低脂肪牛乳2本", [mine, dairy])).toBe(mine.id);
  });

  it("確信が無ければ辞書へ進む", async () => {
    const dairy = category("cat-dairy", "乳製品");
    expect(await inferrerOf([...widgets, ...gadgets]).infer("牛乳", [WIDGET, GADGET, dairy])).toBe(dairy.id);
  });
});

describe("モデルの作り直し", () => {
  it("items と history の参照が同じ間は作り直さない", async () => {
    const history = [...widgets, ...gadgets.slice(0, 2)];
    const records: InferenceRecords = { items: [], history };
    const inferrer = createCategoryInferrer(() => records);
    const categories = [WIDGET, GADGET];
    expect(await inferrer.infer("歯車特大", categories)).toBeNull();

    // 参照を変えずに中身を足しても、前のモデルのまま
    history.push(...gadgets.slice(2));
    expect(await inferrer.infer("歯車特大", categories)).toBeNull();

    records.history = [...history];
    expect(await inferrer.infer("歯車特大", categories)).toBe(GADGET.id);
  });
});

describe("resolveCategory との組み合わせ", () => {
  it("過去の記録に無い名前は推定の出どころで返す", async () => {
    const input = {
      name: "低脂肪牛乳",
      listId: "list-a",
      categories: master,
      items: [],
      history: [],
      inferrer: dictionaryOnly,
    };
    expect(lookupCategory(input).categoryId).toBeNull();
    expect(await resolveCategory(input)).toEqual({ categoryId: idOf("乳製品"), categorySource: "inferred" });
  });
});
