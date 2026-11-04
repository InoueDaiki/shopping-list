import { describe, expect, it } from "vitest";
import { lookupCategory, resolveCategory } from "./category.ts";
import { INFERENCE_DICTIONARY_EXTRA } from "./inference-dictionary-extra.ts";
import { INFERENCE_DICTIONARY } from "./inference-dictionary.ts";
import { INFERENCE_EVAL_DATA } from "./inference-eval-data.ts";
import { createCategoryInferrer } from "./inference.ts";
import { normalizeItemName } from "./normalize.ts";
import { historyFixture } from "./test-support.ts";
import type { Category, HistoryEntry } from "./types.ts";

function category(id: string, name: string): Category {
  return { id, name, sort: 1, updatedAt: "2028-01-01T00:00:00.000Z" };
}

const master = Object.keys(INFERENCE_DICTIONARY).map((name, index) => category(`cat-${index}`, name));
const idOf = (name: string) => master.find((row) => row.name === name)?.id;
const noHistory: readonly HistoryEntry[] = [];
const dictionaryOnly = createCategoryInferrer(() => noHistory);

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

  it("語は 800 から 2000 の範囲にある", () => {
    expect(words.length).toBeGreaterThanOrEqual(800);
    expect(words.length).toBeLessThanOrEqual(2000);
  });

  it("正規化しても同じ語が重ならない", () => {
    const keys = words.map(normalizeItemName);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });

  describe("生成した語彙", () => {
    const extra = Object.entries(INFERENCE_DICTIONARY_EXTRA).flatMap(([name, list]) =>
      list.split("\n").filter((word) => word !== "").map((word) => [word, name] as const),
    );

    it("カテゴリは手の辞書と同じ", () => {
      expect(Object.keys(INFERENCE_DICTIONARY_EXTRA)).toEqual(Object.keys(INFERENCE_DICTIONARY));
    });

    it("語は6万までに抑える", () => {
      expect(extra.length).toBeLessThanOrEqual(60_000);
    });

    it("正規化した形で持ち、手の辞書とも、ほかのカテゴリとも重ならない", () => {
      const curated = new Set(words.map(normalizeItemName));
      const seen = new Set<string>();
      const problems = extra.filter(([word]) => {
        const bad = word !== normalizeItemName(word) || curated.has(word) || seen.has(word);
        seen.add(word);
        return bad;
      });
      expect(problems).toEqual([]);
    });
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
  });

  it.each([
    ["チーズパン", "パン"],
    ["コーヒーゼリー", "菓子"],
    ["りんご酢", "調味料"],
    ["卵10個", "卵"],
    ["牛乳 1L", "乳製品"],
    ["キャベツ1/2", "野菜"],
    ["大根 半分", "野菜"],
    ["あじ4尾", "鮮魚"],
    ["水2L×6本", "飲料"],
  ])("語尾と数量を見る: %s", async (name, expected) => {
    expect(await dictionaryOnly.infer(name, master)).toBe(idOf(expected));
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
  const inferrerOf = (history: readonly HistoryEntry[]) => createCategoryInferrer(() => history);

  it("似た名前の品目から決める", async () => {
    const inferrer = inferrerOf([...widgets, ...gadgets]);
    expect(await inferrer.infer("ねじ特大", categories)).toBe(WIDGET.id);
    expect(await inferrer.infer("歯車特大", categories)).toBe(GADGET.id);
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

  it("辞書にある語は履歴より辞書を使う", async () => {
    const mine = category("cat-mine", "架空の売り場");
    const dairy = category("cat-dairy", "乳製品");
    const history = learned(mine.id, ["低脂肪牛乳", "特濃牛乳", "成分調整牛乳", "牛乳1本", "牛乳2本"]);
    expect(await inferrerOf(history).infer("低脂肪牛乳2本", [mine, dairy])).toBe(dairy.id);
    expect(await inferrerOf(history).infer("低脂肪牛乳2本", [mine])).toBe(mine.id);
  });

  it("確信が無ければ辞書へ進む", async () => {
    const dairy = category("cat-dairy", "乳製品");
    expect(await inferrerOf([...widgets, ...gadgets]).infer("牛乳", [WIDGET, GADGET, dairy])).toBe(dairy.id);
  });
});

describe("品目名の一覧での精度", () => {
  it.each(Object.entries(INFERENCE_EVAL_DATA))("%s は全部当たる", async (_group, rows) => {
    for (const [name, expected] of rows) {
      const allowed = expected.split("|").map(idOf);
      expect(allowed, name).toContain(await dictionaryOnly.infer(name, master));
    }
  });
});

describe("モデルの作り直し", () => {
  it("history の参照が同じ間は作り直さない", async () => {
    const history = [...widgets, ...gadgets.slice(0, 2)];
    let current = history;
    const inferrer = createCategoryInferrer(() => current);
    const categories = [WIDGET, GADGET];
    expect(await inferrer.infer("歯車特大", categories)).toBeNull();

    // 参照を変えずに中身を足しても、前のモデルのまま
    history.push(...gadgets.slice(2));
    expect(await inferrer.infer("歯車特大", categories)).toBeNull();

    current = [...history];
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
