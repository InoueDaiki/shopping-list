// デモモードの初期データ。シートにつながず、端末の確かめと E2E に使う。中身は架空のもの
import { categoriesOfList, type HistoryEntry, type Id, type LocalChange } from "@shopping-list/core";

import type { SqliteLocalStore } from "./localStore.ts";
import type { Repository } from "./repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface SeedInput {
  store: SqliteLocalStore;
  repository: Repository;
  newId: () => Id;
  now: Date;
}

const PAST_ITEMS: readonly (readonly [string, string])[] = [
  ["ヨーグルト", "乳製品"],
  ["豆腐", "豆腐・納豆"],
  ["バナナ", "果物"],
  ["納豆", "豆腐・納豆"],
  ["トマト", "野菜"],
];

export function seedDemo({ store, repository, newId, now }: SeedInput): void {
  // 前の版のデモの写しが残っていれば、共通のカテゴリをリストごとに分ける(デモは同期しないので、ここで呼ぶ)
  repository.splitSharedCategories();
  if (store.rows("lists").length > 0 || store.rows("categories").length > 0) return;
  // リストを足すと、初期のカテゴリもそのリストに入る
  const listId = repository.addList("スーパー");
  repository.addList("ドラッグストア");
  const categories = categoriesOfList(store.rows("categories"), listId);
  const category = (name: string) => categories.find((row) => row.name === name)?.id ?? null;
  const item = (name: string, categoryName: string, memo = "") => {
    const added = repository.addItem(listId, name, { categoryId: category(categoryName), categorySource: "history" });
    if (added && memo) repository.updateItem(added.id, { memo });
  };
  item("牛乳", "乳製品");
  item("鮭の切り身", "鮮魚", "2切れ。作り方 https://example.com/recipe");
  item("鶏もも肉", "生肉");
  item("にんじん", "野菜");
  item("食パン", "パン");
  repository.addItem(listId, "ふしぎな品物", { categoryId: null, categorySource: null });
  // どのリストにも属さない品目(野良品目)。リスト一覧の「未整理」から移す
  repository.addStrayItem("ハンドソープ");
  repository.addStrayItem("ふしぎな置き物");
  store.commitNow(
    PAST_ITEMS.map(([name, categoryName], index): LocalChange => {
      const row: HistoryEntry = {
        id: newId(),
        listId,
        name,
        categoryId: category(categoryName),
        categorySource: "history",
        storeId: null,
        tripId: null,
        checkedAt: new Date(now.getTime() - (index + 1) * DAY_MS).toISOString(),
        checkedSeq: 0,
      };
      return { action: "put", table: "history", row };
    }),
  );
}
