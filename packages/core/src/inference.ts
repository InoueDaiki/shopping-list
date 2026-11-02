// 品目名からカテゴリを推定する。言語モデルは使わず、自分たちの履歴で学ぶ文字 n-gram の
// Naive Bayes と、組み込みの語彙の辞書で決める
import type { CategoryInferrer } from "./category.ts";
import {
  INFERENCE_MIN_CATEGORY_NAMES,
  INFERENCE_MIN_CONFIDENCE,
  INFERENCE_MIN_GRAM_OVERLAP,
  INFERENCE_MIN_PARTIAL_LENGTH,
  INFERENCE_MIN_PARTIAL_LENGTH_KANJI,
  INFERENCE_NGRAM_SIZES,
  INFERENCE_SMOOTHING,
} from "./constants.ts";
import { INFERENCE_DICTIONARY } from "./inference-dictionary.ts";
import { normalizeItemName } from "./normalize.ts";
import type { Category, CategorySource, HistoryEntry, Id, Item } from "./types.ts";

export interface InferenceRecords {
  items: readonly Item[];
  history: readonly HistoryEntry[];
}

interface LearnedCategory {
  // 学習した品目名の数(同じ名前は1回と数える)
  names: number;
  // 全部の n-gram の数
  total: number;
  grams: Map<string, number>;
}

interface CategoryModel {
  categories: Map<Id, LearnedCategory>;
  vocabulary: number;
}

// 語の始めと終わりも手がかりにする。1文字の品目名にも n-gram ができる
const BOUNDARY = "\u0000";

function charGrams(normalizedName: string): string[] {
  const chars = [BOUNDARY, ...normalizedName, BOUNDARY];
  const grams: string[] = [];
  for (const size of INFERENCE_NGRAM_SIZES) {
    for (let start = 0; start + size <= chars.length; start++) {
      grams.push(chars.slice(start, start + size).join(""));
    }
  }
  return grams;
}

// カテゴリがあり、推定で入ったのではない記録で学ぶ。自分の推定で自分を強化しないため。
// 同じ名前を何度買っても1回と数える。それは lookupCategory が引くので、ここで見たいのは
// 名前の広がりで、買う回数が多い品目のカテゴリに寄せたくない
function trainModel({ items, history }: InferenceRecords): CategoryModel {
  const categories = new Map<Id, LearnedCategory>();
  const vocabulary = new Set<string>();
  const seen = new Set<string>();

  const learn = (name: string, categoryId: Id | null, source: CategorySource | null) => {
    if (categoryId === null || source === "inferred") return;
    const normalized = normalizeItemName(name);
    const key = `${categoryId}${BOUNDARY}${normalized}`;
    if (normalized === "" || seen.has(key)) return;
    seen.add(key);

    let learned = categories.get(categoryId);
    if (!learned) {
      learned = { names: 0, total: 0, grams: new Map() };
      categories.set(categoryId, learned);
    }
    learned.names += 1;
    for (const gram of charGrams(normalized)) {
      learned.total += 1;
      learned.grams.set(gram, (learned.grams.get(gram) ?? 0) + 1);
      vocabulary.add(gram);
    }
  };

  for (const item of items) learn(item.name, item.categoryId, item.categorySource);
  for (const entry of history) learn(entry.name, entry.categoryId, entry.categorySource);
  return { categories, vocabulary: vocabulary.size };
}

// 確信があるときだけ答える。マスタから消えたカテゴリは比べない。
// n-gram は独立ではなく確率が極端に出るので、確率のほかに、品目名の n-gram のうち
// 選んだカテゴリで見たことのある割合も見る。品目名の一部が似ているだけなら答えない
function classify(model: CategoryModel, normalizedName: string, categories: readonly Category[]): Id | null {
  const candidates = categories.flatMap((category) => {
    const learned = model.categories.get(category.id);
    return learned ? [{ id: category.id, learned }] : [];
  });
  if (candidates.length === 0) return null;

  const grams = charGrams(normalizedName);
  const namesTotal = candidates.reduce((sum, { learned }) => sum + learned.names, 0);
  const scores = candidates.map(({ learned }) => {
    const denominator = Math.log(learned.total + INFERENCE_SMOOTHING * model.vocabulary);
    let score = Math.log(learned.names / namesTotal);
    for (const gram of grams) {
      score += Math.log((learned.grams.get(gram) ?? 0) + INFERENCE_SMOOTHING) - denominator;
    }
    return score;
  });

  const bestScore = Math.max(...scores);
  const best = candidates[scores.indexOf(bestScore)];
  const confidence = 1 / scores.reduce((sum, score) => sum + Math.exp(score - bestScore), 0);
  const overlap = grams.filter((gram) => best.learned.grams.has(gram)).length / grams.length;

  const isConfident =
    best.learned.names >= INFERENCE_MIN_CATEGORY_NAMES &&
    confidence >= INFERENCE_MIN_CONFIDENCE &&
    overlap >= INFERENCE_MIN_GRAM_OVERLAP;
  return isConfident ? best.id : null;
}

let dictionaryIndex: Map<string, string> | null = null;

// 正規化した語からカテゴリの名前を引く表。起動を重くしないよう、最初の推定のときに作る
function dictionary(): Map<string, string> {
  if (dictionaryIndex === null) {
    dictionaryIndex = new Map();
    for (const [categoryName, words] of Object.entries(INFERENCE_DICTIONARY)) {
      for (const word of words) dictionaryIndex.set(normalizeItemName(word), normalizeItemName(categoryName));
    }
  }
  return dictionaryIndex;
}

// 短い語は別の語の中に偶然現れるので、部分一致では使わない(「もも」と「鶏もも」、「酒」と
// 「酒粕」など)
function canMatchPartially(word: string): boolean {
  const min = /[一-鿿]/.test(word) ? INFERENCE_MIN_PARTIAL_LENGTH_KANJI : INFERENCE_MIN_PARTIAL_LENGTH;
  return word.length >= min;
}

// 完全一致を先に見て、次に最長の部分一致を取る。同じ長さなら後ろの語を取る(日本語の
// 複合語は後ろが中心になる)。マスタに名前の無いカテゴリの語は無かったものとして扱う
function lookUpDictionary(normalizedName: string, categories: readonly Category[]): Id | null {
  const words = dictionary();
  const available = new Map<string, Id>();
  for (const category of categories) {
    const key = normalizeItemName(category.name);
    if (!available.has(key)) available.set(key, category.id);
  }
  const categoryOf = (word: string) => available.get(words.get(word) ?? "") ?? null;

  const exact = categoryOf(normalizedName);
  if (exact !== null) return exact;
  for (let length = normalizedName.length - 1; length >= 1; length--) {
    for (let start = normalizedName.length - length; start >= 0; start--) {
      const word = normalizedName.slice(start, start + length);
      const category = canMatchPartially(word) ? categoryOf(word) : null;
      if (category !== null) return category;
    }
  }
  return null;
}

// 履歴で確信があればそれを、無ければ辞書を、それも無ければ null を返す。
// モデルは items と history の配列の参照が変わったときだけ作り直す
export function createCategoryInferrer(records: () => InferenceRecords): CategoryInferrer {
  let model: CategoryModel | null = null;
  let trainedItems: InferenceRecords["items"] | null = null;
  let trainedHistory: InferenceRecords["history"] | null = null;

  const currentModel = (): CategoryModel => {
    const { items, history } = records();
    if (model === null || items !== trainedItems || history !== trainedHistory) {
      model = trainModel({ items, history });
      trainedItems = items;
      trainedHistory = history;
    }
    return model;
  };

  return {
    async infer(name, categories) {
      const normalized = normalizeItemName(name);
      if (normalized === "") return null;
      return classify(currentModel(), normalized, categories) ?? lookUpDictionary(normalized, categories);
    },
  };
}
