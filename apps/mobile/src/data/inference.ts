// 品目のカテゴリの推定を裏で走らせる。結果が出たら品目へ入れ、失敗したら未分類のままにする
import {
  createCategoryInferrer,
  prepareCategoryInference,
  resolveCategory,
  type CategoryInferrer,
  type HistoryEntry,
  type Id,
  type Item,
} from "@shopping-list/core";

import { localStore, rememberedHistory, repository } from "./runtime.ts";

// カテゴリはリストごとなので、履歴の学習もリストごとに持つ。忘れた品目名は学習に使わない。
// 履歴が変わるまで同じ配列を渡すので、モデルは参照が変わったときだけ作り直される
const inferrers = new Map<Id, CategoryInferrer>();

function inferrerFor(listId: Id): CategoryInferrer {
  let inferrer = inferrers.get(listId);
  if (!inferrer) {
    let held: { source: readonly HistoryEntry[]; rows: readonly HistoryEntry[] } | null = null;
    inferrer = createCategoryInferrer(() => {
      const source = rememberedHistory();
      if (held?.source !== source) held = { source, rows: source.filter((entry) => entry.listId === listId) };
      return held.rows;
    });
    inferrers.set(listId, inferrer);
  }
  return inferrer;
}

async function inferAndApply(item: Item, listId: Id): Promise<void> {
  // 追加の操作の描画を先に済ませる
  await new Promise((resolve) => setTimeout(resolve, 0));
  const { categoryId } = await resolveCategory({
    name: item.name,
    listId,
    categories: localStore.rows("categories"),
    items: localStore.rows("items"),
    history: rememberedHistory(),
    inferrer: inferrerFor(listId),
  });
  if (categoryId !== null) repository.applyInferredCategory(item.id, categoryId);
}

// 未分類の品目を受けて投げっぱなしで推定する。呼ぶ側を待たせず、例外も外へ出さない。
// 野良品目はカテゴリを持たないので推定しない(リストへ移したときに推定する)
export function inferItemCategory(item: Item): void {
  if (item.categoryId !== null || item.listId === null) return;
  inferAndApply(item, item.listId).catch(() => undefined);
}

// 入力欄に触れたら、キーボードが出終わるのを待って辞書の表を作っておく。打ち終わるまでに済み、
// 足した瞬間に止まらない
const PREPARE_DELAY_MS = 400;
let prepared = false;

export function prepareItemInference(): void {
  if (prepared) return;
  prepared = true;
  setTimeout(prepareCategoryInference, PREPARE_DELAY_MS);
}
