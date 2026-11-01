import { normalizeItemName } from "./normalize.ts";
import type { Category, CategorySource, HistoryEntry, Id, Item } from "./types.ts";

// 品目名からマスタのカテゴリを1つ選ぶ。分からなければ null を返す。
// 端末に依る実装は差し込む。返した ID がマスタに無ければ resolveCategory が捨てる
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
  listId: Id;
  categories: readonly Category[];
  items: readonly Item[];
  history: readonly HistoryEntry[];
}

export interface ResolveCategoryInput extends CategoryLookupInput {
  inferrer?: CategoryInferrer | null;
}

const UNCATEGORIZED: CategoryResolution = { categoryId: null, categorySource: null };

// 記録の強さ。履歴には category_source が無いので、中間の扱いになる
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
// 同じリストの記録はほかのリストより強く、同じ側の中では利用者の修正がいちばん強い
export function lookupCategory(input: CategoryLookupInput): CategoryResolution {
  const target = normalizeItemName(input.name);
  if (target === "") return UNCATEGORIZED;
  const known = new Set(input.categories.map((category) => category.id));

  const records = [
    ...input.items.map((item) => ({
      ...item,
      source: item.categorySource,
      at: item.updatedAt,
    })),
    ...input.history.map((entry) => ({ ...entry, source: null, at: entry.checkedAt })),
  ];

  let best: CategoryRecord | null = null;
  for (const record of records) {
    // 未分類の記録と、マスタから消えたカテゴリの記録は手がかりにならない
    if (record.categoryId === null || !known.has(record.categoryId)) continue;
    if (normalizeItemName(record.name) !== target) continue;
    const candidate: CategoryRecord = {
      id: record.id,
      categoryId: record.categoryId,
      sameList: record.listId === input.listId,
      strength: SOURCE_STRENGTH[record.source ?? "none"],
      at: Date.parse(record.at),
    };
    if (best === null || isStronger(candidate, best)) best = candidate;
  }

  return best === null ? UNCATEGORIZED : { categoryId: best.categoryId, categorySource: "history" };
}

// 同じリスト、ほかのリスト、推定、未分類の順で決める。
// 推定の失敗は未分類として扱い、品目の追加を止めない
export async function resolveCategory(input: ResolveCategoryInput): Promise<CategoryResolution> {
  const resolved = lookupCategory(input);
  if (resolved.categoryId !== null || !input.inferrer) return resolved;
  if (normalizeItemName(input.name) === "") return UNCATEGORIZED;

  let inferred: Id | null;
  try {
    inferred = await input.inferrer.infer(input.name, input.categories);
  } catch {
    return UNCATEGORIZED;
  }
  const isKnown = input.categories.some((category) => category.id === inferred);
  return isKnown ? { categoryId: inferred, categorySource: "inferred" } : UNCATEGORIZED;
}
