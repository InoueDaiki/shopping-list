// 野良品目(どのリストにも属さない品目)を足す。品目の追加画面(リストを決めずに開く)から使う
import { lookupCategory, type Item } from "@shopping-list/core";

import { inferItemCategory } from "./inference.ts";
import { localStore, rememberedHistory, repository } from "./runtime.ts";

// カテゴリはリストの入力欄と同じく、過去の品目から待たずに決め(リストが無いので、どのリストの記録も同じ重さで見る)、
// 分からなければ未分類で入れて裏で推定する。同じ名前の野良品目があれば足さず、null を返す
export function addStrayItem(name: string): Item | null {
  const category = lookupCategory({
    name,
    listId: null,
    categories: localStore.rows("categories"),
    items: localStore.rows("items"),
    history: rememberedHistory(),
  });
  const item = repository.addStrayItem(name, category);
  if (item?.categoryId === null) inferItemCategory(item);
  return item;
}
