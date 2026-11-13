import { categoriesOfList } from "./listCategories.ts";
import { normalizeItemName } from "./normalize.ts";
import type { Category, CategorySource, HistoryEntry, Id, Item } from "./types.ts";

// 品目名から、渡したカテゴリ(品目のリストのカテゴリ)の1つを選ぶ。分からなければ null を返す。
// 端末に依る実装は差し込む。返した ID がそのリストに無ければ resolveCategory が捨てる
export interface CategoryInferrer {
  infer(name: string, categories: readonly Category[]): Promise<Id | null>;
}

// Item の同じ名前の欄へそのまま入れられる形。未分類はどちらも null
export interface CategoryResolution {
  categoryId: Id | null;
  categorySource: CategorySource | null;
}

export interface CategoryLookupInput {
  name: string;
  // 品目のリスト。野良品目(どのリストにも属さない品目)はカテゴリを持たないので、引かない
  listId: Id;
  // すべてのリストのカテゴリ。ほかのリストの記録を、カテゴリの名前でこのリストへ引き当てる
  categories: readonly Category[];
  items: readonly Item[];
  history: readonly HistoryEntry[];
}

export interface ResolveCategoryInput extends CategoryLookupInput {
  inferrer?: CategoryInferrer | null;
}

const UNCATEGORIZED: CategoryResolution = { categoryId: null, categorySource: null };

// 記録の強さ。品目と履歴で同じ。出どころの分からない記録は中間の扱いになる
const SOURCE_STRENGTH = { user: 2, history: 1, none: 1, inferred: 0 } as const;

interface CategoryRecord {
  id: Id;
  categoryId: Id;
  sameList: boolean;
  strength: number;
  at: number;
}

function isStronger(a: CategoryRecord, b: CategoryRecord): boolean {
  if (a.sameList !== b.sameList) return a.sameList;
  if (a.strength !== b.strength) return a.strength > b.strength;
  if (a.at !== b.at) return a.at > b.at;
  return a.id < b.id;
}

// 過去の品目から同期的に引く。品目を追加するときは待たせないよう、まずこれを使う。
// 同じリストの記録はほかのリストより強く、同じ側の中では利用者の修正がいちばん強い。
// カテゴリはリストごとなので、同じリストの記録は ID のまま使い、ほかのリストの記録は、
// 同じ名前のカテゴリがこのリストにあるときだけ、このリストのカテゴリとして使う
export function lookupCategory(input: CategoryLookupInput): CategoryResolution {
  const target = normalizeItemName(input.name);
  if (target === "") return UNCATEGORIZED;
  const own = categoriesOfList(input.categories, input.listId);
  const known = new Set(own.map((category) => category.id));
  // 名前の重なったカテゴリは、マスタの順で先のものにする
  const ownByName = new Map<string, Id>();
  for (const category of own) {
    const key = normalizeItemName(category.name);
    if (!ownByName.has(key)) ownByName.set(key, category.id);
  }
  const nameOf = new Map(input.categories.map((category) => [category.id, normalizeItemName(category.name)]));
  const ownCategory = (categoryId: Id, sameList: boolean): Id | null => {
    if (sameList) return known.has(categoryId) ? categoryId : null;
    return ownByName.get(nameOf.get(categoryId) ?? "") ?? null;
  };

  const records = [
    ...input.items.map((item) => ({
      ...item,
      source: item.categorySource,
      at: item.updatedAt,
    })),
    ...input.history.map((entry) => ({
      ...entry,
      source: entry.categorySource,
      at: entry.checkedAt,
    })),
  ];

  let best: CategoryRecord | null = null;
  for (const record of records) {
    if (record.categoryId === null || normalizeItemName(record.name) !== target) continue;
    const sameList = record.listId === input.listId;
    // 未分類の記録と、マスタから消えたカテゴリの記録と、このリストに同じ名前のカテゴリが無い
    // ほかのリストの記録は、手がかりにならない
    const categoryId = ownCategory(record.categoryId, sameList);
    if (categoryId === null) continue;
    const candidate: CategoryRecord = {
      id: record.id,
      categoryId,
      sameList,
      strength: SOURCE_STRENGTH[record.source ?? "none"],
      at: Date.parse(record.at),
    };
    if (best === null || isStronger(candidate, best)) best = candidate;
  }

  if (best === null) return UNCATEGORIZED;
  // 推定の記録しか無いときは推定のまま渡す。履歴の出どころにすると強い記録に化ける
  const categorySource = best.strength === SOURCE_STRENGTH.inferred ? "inferred" : "history";
  return { categoryId: best.categoryId, categorySource };
}

// 同じリスト、ほかのリスト、推定、未分類の順で決める。推定はそのリストのカテゴリを相手にする。
// 推定の失敗は未分類として扱い、品目の追加を止めない
export async function resolveCategory(input: ResolveCategoryInput): Promise<CategoryResolution> {
  const resolved = lookupCategory(input);
  if (resolved.categoryId !== null || !input.inferrer) return resolved;
  if (normalizeItemName(input.name) === "") return UNCATEGORIZED;

  const own = categoriesOfList(input.categories, input.listId);
  let inferred: Id | null;
  try {
    inferred = await input.inferrer.infer(input.name, own);
  } catch {
    return UNCATEGORIZED;
  }
  const isKnown = own.some((category) => category.id === inferred);
  return isKnown ? { categoryId: inferred, categorySource: "inferred" } : UNCATEGORIZED;
}
