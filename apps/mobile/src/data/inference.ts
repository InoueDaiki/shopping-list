// 品目のカテゴリの推定を裏で走らせる。結果が出たら品目へ入れ、失敗したら未分類のままにする
import { createCategoryInferrer, resolveCategory, type Item } from "@shopping-list/core";

import { localStore, rememberedHistory, repository } from "./runtime.ts";

// 忘れた品目名は学習に使わない
const inferrer = createCategoryInferrer(rememberedHistory);

async function inferAndApply(item: Item): Promise<void> {
  // 追加の操作の描画を先に済ませる
  await new Promise((resolve) => setTimeout(resolve, 0));
  const { categoryId } = await resolveCategory({
    name: item.name,
    listId: item.listId,
    categories: localStore.rows("categories"),
    items: localStore.rows("items"),
    history: rememberedHistory(),
    inferrer,
  });
  if (categoryId !== null) repository.applyInferredCategory(item.id, categoryId);
}

// 未分類の品目を受けて投げっぱなしで推定する。呼ぶ側を待たせず、例外も外へ出さない
export function inferItemCategory(item: Item): void {
  if (item.categoryId !== null) return;
  inferAndApply(item).catch(() => undefined);
}
