// 品目名を忘れる。品目のマスタは無く、候補もカテゴリも履歴から作るので、履歴のうち忘れた分を
// 見ないことで消す。履歴そのものは消さない(売り場の順の学習は品目名に依らないので、全部を使い続ける)
import { normalizeItemName } from "./normalize.ts";
import type { ForgottenItem, HistoryEntry, Id, Iso } from "./types.ts";

const keyOf = (listId: Id, normalizedName: string) => `${listId}\0${normalizedName}`;

// リストと名前ごとの、いちばん新しい忘れた時刻。2台が同時に忘れて記録が2つになっても新しいほうが効く
function cutoffs(forgotten: readonly ForgottenItem[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const row of forgotten) {
    const key = keyOf(row.listId, row.normalizedName);
    const at = Date.parse(row.forgottenAt);
    if (Number.isNaN(at)) continue;
    if (at > (latest.get(key) ?? -Infinity)) latest.set(key, at);
  }
  return latest;
}

// 忘れた分を除いた履歴。同じリストで、正規化した名前が同じで、忘れた時刻までに買った記録を除く。
// 除くものが無ければ同じ配列を返す(推定の学習は配列が変わったときだけやり直すため)
export function withoutForgotten(
  history: readonly HistoryEntry[],
  forgotten: readonly ForgottenItem[],
): readonly HistoryEntry[] {
  if (forgotten.length === 0) return history;
  const latest = cutoffs(forgotten);
  const kept = history.filter((entry) => {
    const at = latest.get(keyOf(entry.listId, normalizeItemName(entry.name)));
    return at === undefined || Date.parse(entry.checkedAt) > at;
  });
  return kept.length === history.length ? history : kept;
}

// 品目の管理の画面に出す、登録済みの品目名
export interface RegisteredItem {
  // いちばん新しい記録の表記とカテゴリ
  name: string;
  normalizedName: string;
  categoryId: Id | null;
  count: number;
  lastCheckedAt: Iso;
}

export interface RegisteredItemsInput {
  listId: Id;
  // 忘れた分を除いた履歴(withoutForgotten)
  history: readonly HistoryEntry[];
}

// そのリストの登録済みの品目名を、名前ごとにまとめて、最後に買った日の新しい順に返す
export function registeredItems({ listId, history }: RegisteredItemsInput): RegisteredItem[] {
  const grouped = new Map<string, RegisteredItem>();
  for (const entry of history) {
    if (entry.listId !== listId) continue;
    const normalizedName = normalizeItemName(entry.name);
    if (normalizedName === "") continue;
    const group = grouped.get(normalizedName);
    if (!group) {
      grouped.set(normalizedName, {
        name: entry.name,
        normalizedName,
        categoryId: entry.categoryId,
        count: 1,
        lastCheckedAt: entry.checkedAt,
      });
      continue;
    }
    group.count++;
    if (Date.parse(entry.checkedAt) > Date.parse(group.lastCheckedAt)) {
      group.name = entry.name;
      group.categoryId = entry.categoryId;
      group.lastCheckedAt = entry.checkedAt;
    }
  }
  return [...grouped.values()].sort(
    (a, b) =>
      Date.parse(b.lastCheckedAt) - Date.parse(a.lastCheckedAt) ||
      (a.normalizedName < b.normalizedName ? -1 : a.normalizedName > b.normalizedName ? 1 : 0),
  );
}

// 検索の入力に合う品目。表記の揺れ(ひらがなとカタカナ、全角と半角)は正規化でそろえる
export function filterRegisteredItems(items: readonly RegisteredItem[], query: string): readonly RegisteredItem[] {
  const key = normalizeItemName(query);
  return key === "" ? items : items.filter((item) => item.normalizedName.includes(key));
}
