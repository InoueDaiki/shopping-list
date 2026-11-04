// 品目を足す。リストの入力欄と、品目の追加画面(ウィジェットから開く)から使う
import { lookupCategory, type Id, type Item } from "@shopping-list/core";

import { inferItemCategory } from "./inference.ts";
import { localStore, rememberedHistory, repository } from "./runtime.ts";

// カテゴリは過去の品目から待たずに決め、分からなければ未分類で入れて裏で推定する。
// listId が null なら野良品目(どのリストにも属さない品目)にし、どのリストの記録も同じ重さで見る。
// 同じ名前のまだ買っていない品目があれば足さず、null を返す
function addItem(listId: Id | null, name: string): Item | null {
  const category = lookupCategory({
    name,
    listId,
    categories: localStore.rows("categories"),
    items: localStore.rows("items"),
    history: rememberedHistory(),
  });
  const item = listId === null ? repository.addStrayItem(name, category) : repository.addItem(listId, name, category);
  if (item?.categoryId === null) inferItemCategory(item);
  return item;
}

export function addListItem(listId: Id, name: string): Item | null {
  return addItem(listId, name);
}

export function addStrayItem(name: string): Item | null {
  return addItem(null, name);
}
