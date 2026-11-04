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
import { INFERENCE_DICTIONARY_EXTRA } from "./inference-dictionary-extra.ts";
import { INFERENCE_DICTIONARY } from "./inference-dictionary.ts";
import { normalizeItemName } from "./normalize.ts";
import type { Category, CategorySource, HistoryEntry, Id } from "./types.ts";

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

// カテゴリがあり、推定で入ったのではない履歴で学ぶ。自分の推定で自分を強化しないため。
// 今の品目は使わない。足すたびに配列が変わり、毎回学習し直すことになるため。
// 同じ名前を何度買っても1回と数える。それは lookupCategory が引くので、ここで見たいのは
// 名前の広がりで、買う回数が多い品目のカテゴリに寄せたくない
function trainModel(history: readonly HistoryEntry[]): CategoryModel {
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

interface DictionaryIndex {
  // 正規化した語から、正規化したカテゴリの名前を引く
  words: Map<string, string>;
  // いちばん長い語の文字数。これより長い切れ端は引かない
  longest: number;
}

let dictionaryIndex: DictionaryIndex | null = null;

// 語からカテゴリの名前を引く表。起動を重くしないよう、最初の推定か prepareCategoryInference の
// ときに作る。生成した語は正規化済みなのでそのまま入れ、手の辞書の語は後から入れて優先する
function dictionary(): DictionaryIndex {
  if (dictionaryIndex === null) {
    const words = new Map<string, string>();
    for (const [categoryName, list] of Object.entries(INFERENCE_DICTIONARY_EXTRA)) {
      const category = normalizeItemName(categoryName);
      for (const word of list.split("\n")) if (word !== "") words.set(word, category);
    }
    for (const [categoryName, list] of Object.entries(INFERENCE_DICTIONARY)) {
      const category = normalizeItemName(categoryName);
      for (const word of list) words.set(normalizeItemName(word), category);
    }
    let longest = 0;
    for (const word of words.keys()) longest = Math.max(longest, word.length);
    dictionaryIndex = { words, longest };
  }
  return dictionaryIndex;
}

// 推定の前に辞書の表を作っておく。5万語あるので、品目を足した瞬間に作ると一瞬止まる
export function prepareCategoryInference(): void {
  dictionary();
}

// 短い語は別の語の中に偶然現れるので、部分一致では使わない(「もも」と「鶏もも」、「酒」と
// 「酒粕」など)
function canMatchPartially(word: string): boolean {
  const min = /[一-鿿]/.test(word) ? INFERENCE_MIN_PARTIAL_LENGTH_KANJI : INFERENCE_MIN_PARTIAL_LENGTH;
  return word.length >= min;
}

// 語尾では短い語も使う。日本語の複合語は後ろが中心になる(「チーズパン」はパン、
// 「りんご酢」は酢)。漢字なら1文字でもよいが、かなの2文字は偶然が多いので「ぱん」だけ
function canMatchAtEnd(word: string): boolean {
  return word === "ぱん" || word.length >= INFERENCE_MIN_PARTIAL_LENGTH || /[一-鿿]/.test(word);
}

// 語尾の数量と量の指定を除く(「卵10個」「牛乳 1l」「キャベツ1/2」「大根 半分」「あじ4尾」「水2l×6本」)
const QUANTITY_SUFFIX =
  /\s*[×x*]?\s*(?:\d+(?:[./]\d+)?\s*(?:個|こ|本|枚|袋|ぱっく|p|缶|玉|丁|切れ|切|束|箱|ろーる|尾|匹|杯|連|房|斤|けーす|せっと|kg|g|l|ml|cc)?(?:入り?)?|半分|半玉|少々|小袋|大袋|徳用)$/;

// 「水2l 6本」のように重なることがあるので、変わらなくなるまで除く
function withoutQuantity(normalizedName: string): string {
  const name = normalizedName.replace(QUANTITY_SUFFIX, "").trim();
  return name === normalizedName ? name : withoutQuantity(name);
}

const availableCache = new WeakMap<readonly Category[], Map<string, Id>>();

// 正規化したカテゴリの名前から ID を引く表。同じマスタの配列なら作り直さない
function availableCategories(categories: readonly Category[]): Map<string, Id> {
  let available = availableCache.get(categories);
  if (!available) {
    available = new Map();
    for (const category of categories) {
      const key = normalizeItemName(category.name);
      if (!available.has(key)) available.set(key, category.id);
    }
    availableCache.set(categories, available);
  }
  return available;
}

// 完全一致、語尾の最長の語、どこかの最長の語の順に見る。同じ長さなら後ろの語を取る。
// マスタに名前の無いカテゴリの語は無かったものとして扱う。切れ端は1つずつ表で引くので、
// かかる時間は辞書の語の数ではなく品目名の長さで決まる
function lookUpDictionary(normalizedName: string, categories: readonly Category[]): Id | null {
  const { words, longest } = dictionary();
  const available = availableCategories(categories);
  const categoryOf = (word: string) => available.get(words.get(word) ?? "") ?? null;

  const exact = categoryOf(normalizedName);
  if (exact !== null) return exact;
  const name = withoutQuantity(normalizedName);
  const bare = categoryOf(name);
  if (bare !== null) return bare;
  for (let start = Math.max(1, name.length - longest); start < name.length; start++) {
    const word = name.slice(start);
    const category = canMatchAtEnd(word) ? categoryOf(word) : null;
    if (category !== null) return category;
  }
  for (let length = Math.min(name.length - 1, longest); length >= 1; length--) {
    for (let start = name.length - length; start >= 0; start--) {
      const word = name.slice(start, start + length);
      const category = canMatchPartially(word) ? categoryOf(word) : null;
      if (category !== null) return category;
    }
  }
  return null;
}

// 辞書を先に見て、無ければ履歴で確信があるものを返す。文字の並びだけの学習は、辞書の語を
// 履歴より先に見ないと壊す(検証で、辞書と違う答えの9割以上が誤りだった。「バター」が
// 「バターコーヒー」に引かれるなど)。正しい修正は lookupCategory が同じ名前で先に引く。
// モデルは history の配列の参照が変わったときだけ作り直す
export function createCategoryInferrer(records: () => readonly HistoryEntry[]): CategoryInferrer {
  let model: CategoryModel | null = null;
  let trainedHistory: readonly HistoryEntry[] | null = null;

  const currentModel = (): CategoryModel => {
    const history = records();
    if (model === null || history !== trainedHistory) {
      model = trainModel(history);
      trainedHistory = history;
    }
    return model;
  };

  return {
    async infer(name, categories) {
      const normalized = normalizeItemName(name);
      if (normalized === "") return null;
      return lookUpDictionary(normalized, categories) ?? classify(currentModel(), normalized, categories);
    },
  };
}
