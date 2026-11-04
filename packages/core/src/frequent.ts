import { DAY_MS, FREQUENT_HALF_LIFE_DAYS, FREQUENT_LIMIT, SUGGESTION_LIMIT } from "./constants.ts";
import { withoutForgotten } from "./forgotten.ts";
import { normalizeItemName } from "./normalize.ts";
import type { ForgottenItem, HistoryEntry, Id, Iso, Item, ShoppingList } from "./types.ts";

export interface FrequentItem {
  // いちばん新しい記録の表記とカテゴリ
  name: string;
  normalizedName: string;
  categoryId: Id | null;
  count: number;
  lastCheckedAt: Iso;
  score: number;
}

export interface FrequentItemsInput {
  listId: Id;
  history: readonly HistoryEntry[];
  // そのリストの品目は候補から除く。チェック済みでも、リストにある間は除く
  items: readonly Item[];
  now: Iso;
  limit?: number;
}

export interface ItemSuggestionsInput extends FrequentItemsInput {
  query: string;
}

export interface ItemSuggestion extends FrequentItem {
  // list: そのリストの履歴から。otherList: ほかのリストの履歴から
  origin: "list" | "otherList";
}

// 新しさの重み。今なら 1 で、半減期ごとに半分になる。未来の日時は今として扱う
function recencyWeight(lastCheckedAt: Iso, now: number): number {
  const ageDays = Math.max(0, now - Date.parse(lastCheckedAt)) / DAY_MS;
  return 0.5 ** (ageDays / FREQUENT_HALF_LIFE_DAYS);
}

// 回数 × 最後に買った日の新しさの重みを、スコアの高い順に返す
function scoreEntries(entries: readonly HistoryEntry[], now: Iso): FrequentItem[] {
  const nowMs = Date.parse(now);
  const grouped = new Map<string, { latest: HistoryEntry; count: number }>();
  for (const entry of entries) {
    const key = normalizeItemName(entry.name);
    if (key === "") continue;
    const group = grouped.get(key);
    if (!group) {
      grouped.set(key, { latest: entry, count: 1 });
      continue;
    }
    group.count++;
    if (Date.parse(entry.checkedAt) > Date.parse(group.latest.checkedAt)) group.latest = entry;
  }

  const scored = [...grouped].map(([normalizedName, { latest, count }]) => ({
    name: latest.name,
    normalizedName,
    categoryId: latest.categoryId,
    count,
    lastCheckedAt: latest.checkedAt,
    score: count * recencyWeight(latest.checkedAt, nowMs),
  }));
  return scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.normalizedName < b.normalizedName ? -1 : a.normalizedName > b.normalizedName ? 1 : 0),
  );
}

function namesOnList(items: readonly Item[], listId: Id): Set<string> {
  return new Set(
    items.filter((item) => item.listId === listId).map((item) => normalizeItemName(item.name)),
  );
}

// リストごとのよく使う品目を、スコアの高い順に返す
export function frequentItems(input: FrequentItemsInput): FrequentItem[] {
  const onList = namesOnList(input.items, input.listId);
  const entries = input.history.filter((entry) => entry.listId === input.listId);
  return scoreEntries(entries, input.now)
    .filter((item) => !onList.has(item.normalizedName))
    .slice(0, input.limit ?? FREQUENT_LIMIT);
}

// 入力中の候補。まずそのリストから出し、足りなければほかのリストから足す
export function itemSuggestions(input: ItemSuggestionsInput): ItemSuggestion[] {
  const query = normalizeItemName(input.query);
  if (query === "") return [];
  const limit = input.limit ?? SUGGESTION_LIMIT;
  const onList = namesOnList(input.items, input.listId);
  const matches = (item: FrequentItem): boolean =>
    item.normalizedName.includes(query) && !onList.has(item.normalizedName);

  const own = input.history.filter((entry) => entry.listId === input.listId);
  const fromList = scoreEntries(own, input.now).filter(matches).slice(0, limit);
  const suggestions: ItemSuggestion[] = fromList.map((item) => ({ ...item, origin: "list" }));
  if (suggestions.length >= limit) return suggestions;

  const seen = new Set(fromList.map((item) => item.normalizedName));
  const others = input.history.filter((entry) => entry.listId !== input.listId);
  const fromOthers = scoreEntries(others, input.now)
    .filter((item) => matches(item) && !seen.has(item.normalizedName))
    .slice(0, limit - suggestions.length);
  return [...suggestions, ...fromOthers.map((item) => ({ ...item, origin: "otherList" as const }))];
}

export interface CrossListSuggestionsInput {
  query: string;
  // 候補を出すリスト。ここに無いリスト(消したリスト)の履歴は出さない。同点はこの sort の順
  lists: readonly ShoppingList[];
  history: readonly HistoryEntry[];
  // 忘れた品目名の記録。忘れた分の履歴を除く(withoutForgotten)。除いた履歴を渡しても同じになる
  forgotten: readonly ForgottenItem[];
  // 今リストにある品目。そのリストの候補から除く。チェック済みでも、リストにある間は除く
  items: readonly Item[];
  now: Iso;
  limit?: number;
}

export interface CrossListSuggestion extends FrequentItem {
  // この候補を選んだときに足すリスト
  listId: Id;
}

// すべてのリストをまたいだ入力中の候補。品目の追加画面(リストを決めずに開く)で使う。
// 同じ名前でもリストごとに別の候補にする(牛乳(リスト A)、牛乳(リスト B))。照合とスコアは
// itemSuggestions と同じで、リストをまたいでスコアの高い順に並べる
export function crossListSuggestions(input: CrossListSuggestionsInput): CrossListSuggestion[] {
  const query = normalizeItemName(input.query);
  if (query === "") return [];
  const limit = input.limit ?? SUGGESTION_LIMIT;
  const sortOf = new Map(input.lists.map((list) => [list.id, list.sort]));
  const byList = new Map<Id, HistoryEntry[]>();
  for (const entry of withoutForgotten(input.history, input.forgotten)) {
    if (!sortOf.has(entry.listId)) continue;
    const entries = byList.get(entry.listId);
    if (entries) entries.push(entry);
    else byList.set(entry.listId, [entry]);
  }

  const suggestions = [...byList].flatMap(([listId, entries]) => {
    const onList = namesOnList(input.items, listId);
    return scoreEntries(entries, input.now)
      .filter((item) => item.normalizedName.includes(query) && !onList.has(item.normalizedName))
      .map((item): CrossListSuggestion => ({ ...item, listId }));
  });
  const listOrder = (a: CrossListSuggestion, b: CrossListSuggestion) =>
    (sortOf.get(a.listId) ?? 0) - (sortOf.get(b.listId) ?? 0) || (a.listId < b.listId ? -1 : a.listId > b.listId ? 1 : 0);
  return suggestions
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.normalizedName < b.normalizedName ? -1 : a.normalizedName > b.normalizedName ? 1 : 0) ||
        listOrder(a, b),
    )
    .slice(0, limit);
}
