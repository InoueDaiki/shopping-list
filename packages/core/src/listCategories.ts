// リストごとのカテゴリ。マスタはリストごとに持ち、版 7 までの共通のカテゴリ(listId が null)は
// リストごとに分ける。History は書き換えられないので、古い ID は読むときに読み替える
import type { Category, HistoryEntry, Id } from "./types.ts";

// 初期のカテゴリ。キーは共通だったころの ID(cat_<キー>)の一部で、変えない。
// 名前は推定の辞書(inference-dictionary.ts)のキーと同じにする
const INITIAL_CATEGORY_NAMES: readonly (readonly [string, string])[] = [
  ["seafood", "鮮魚"],
  ["meat", "生肉"],
  ["dairy", "乳製品"],
  ["vegetables", "野菜"],
  ["fruit", "果物"],
  ["eggs", "卵"],
  ["tofu_natto", "豆腐・納豆"],
  ["bread", "パン"],
  ["noodles_rice", "麺・米"],
  ["seasonings", "調味料"],
  ["frozen", "冷凍"],
  ["snacks", "菓子"],
  ["drinks", "飲料"],
  ["alcohol", "酒"],
  ["household", "日用品"],
  ["medicine", "医薬品"],
];

// 初期のカテゴリの版。どの編集よりも古い固定の値にする
const SEED_AT = "2000-01-01T00:00:00.000Z";

// 共通のカテゴリを、あるリストのカテゴリにしたときの ID。決まった形なので、2台が同時に
// 分けても、同時に同じリストの初期のカテゴリを作っても同じ行になる。ID の形(64文字まで)に
// 収まる(初期の ID は 16 文字まで、乱数の ID は 21 文字)
export function listCategoryId(sharedId: Id, listId: Id): Id {
  return `${sharedId}-${listId}`;
}

// 新しいリストに入れる初期のカテゴリ一式。ID は、共通の初期のカテゴリをそのリストへ分けたときと同じ
export function initialCategories(listId: Id): Category[] {
  return INITIAL_CATEGORY_NAMES.map(([key, name], index) => ({
    id: listCategoryId(`cat_${key}`, listId),
    name,
    sort: index + 1,
    updatedAt: SEED_AT,
    listId,
  }));
}

const ofListCache = new WeakMap<readonly Category[], Map<Id | null, readonly Category[]>>();

// そのリストのカテゴリ。null は共通のカテゴリ(移行の途中)。同じマスタの配列なら同じ配列を返す
// (順番の計算や推定の表は、配列が変わったときだけ作り直すため)
export function categoriesOfList(categories: readonly Category[], listId: Id | null): readonly Category[] {
  let byList = ofListCache.get(categories);
  if (!byList) {
    byList = new Map();
    ofListCache.set(categories, byList);
  }
  let own = byList.get(listId);
  if (!own) {
    own = categories.filter((category) => category.listId === listId);
    byList.set(listId, own);
  }
  return own;
}

const idsCache = new WeakMap<readonly Category[], Set<Id>>();

function categoryIds(categories: readonly Category[]): Set<Id> {
  let ids = idsCache.get(categories);
  if (!ids) {
    ids = new Set(categories.map((category) => category.id));
    idsCache.set(categories, ids);
  }
  return ids;
}

// 共通だったころの ID を、そのリストのカテゴリの ID として読む。今のカテゴリにある ID と、
// 分けた先がそのリストに無い ID はそのまま返す
function rehomeId(id: Id, listId: Id, known: ReadonlySet<Id>): Id {
  if (known.has(id)) return id;
  const rehomed = listCategoryId(id, listId);
  return known.has(rehomed) ? rehomed : id;
}

// 履歴の、共通だったころのカテゴリの ID を、その履歴のリストのカテゴリの ID に読み替える。
// 変わらない行は同じオブジェクトを、1行も変わらなければ同じ配列を返す(画面と学習のメモ化が効く)
export function rehomeHistory(history: readonly HistoryEntry[], categories: readonly Category[]): readonly HistoryEntry[] {
  const known = categoryIds(categories);
  let changed = false;
  const rows = history.map((entry) => {
    if (entry.categoryId === null) return entry;
    const categoryId = rehomeId(entry.categoryId, entry.listId, known);
    if (categoryId === entry.categoryId) return entry;
    changed = true;
    return { ...entry, categoryId };
  });
  return changed ? rows : history;
}

// 手の順番の ID を、店舗のリスト(決まっていない店舗は開いているリスト)で同じように読み替える。
// 1つも変わらなければ同じ配列を返す
export function rehomeCategoryIds(ids: readonly Id[], listId: Id, categories: readonly Category[]): readonly Id[] {
  const known = categoryIds(categories);
  const rehomed = ids.map((id) => rehomeId(id, listId, known));
  return rehomed.some((id, index) => id !== ids[index]) ? rehomed : ids;
}
