// 品目を足す。リストの入力欄と、品目の追加画面(ウィジェットから開く)から使う
import { lookupCategory, type Id, type Item } from "@shopping-list/core";

import { inferItemCategory } from "./inference.ts";
import { localStore, rememberedHistory, repository } from "./runtime.ts";

// カテゴリは過去の品目から待たずに決め、分からなければ未分類で入れて裏で推定する。
// 同じ名前のまだ買っていない品目があれば足さず、null を返す
export function addListItem(listId: Id, name: string): Item | null {
  const category = lookupCategory({
    name,
    listId,
    categories: localStore.rows("categories"),
    items: localStore.rows("items"),
    history: rememberedHistory(),
  });
  const item = repository.addItem(listId, name, category);
  if (item) inferItemCategory(item);
  return item;
}

// 野良品目(どのリストにも属さない品目)を足す。カテゴリはリストのものなので、移すときに決める
export function addStrayItem(name: string): Item | null {
  return repository.addStrayItem(name);
}

// 野良品目をリストへ移す。カテゴリは移す先のリストの記録から決め、分からなければ裏で推定する
export function moveStrayItem(id: Id, listId: Id): Item | null {
  const moved = repository.moveStrayItem(id, listId);
  if (moved) inferItemCategory(moved);
  return moved;
}
