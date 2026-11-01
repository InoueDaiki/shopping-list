import type { ListDirection } from "./direction.ts";
import { normalizeItemName } from "./normalize.ts";
import type { Id, Item } from "./types.ts";

export interface ItemSection {
  // 未分類は null
  categoryId: Id | null;
  items: Item[];
}

export interface SectionedItems {
  unchecked: ItemSection[];
  checked: ItemSection[];
}

export interface SectionItemsInput {
  items: readonly Item[];
  // 店舗の順番。店舗が決まっていなければマスタの順を渡す
  order: readonly Id[];
  direction: ListDirection;
}

function compareItems(a: Item, b: Item): number {
  const [nameA, nameB] = [normalizeItemName(a.name), normalizeItemName(b.name)];
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toSections(items: readonly Item[], order: readonly Id[]): ItemSection[] {
  const grouped = new Map<Id | null, Item[]>();
  const known = new Set(order);
  for (const item of items) {
    // 順番に無いカテゴリは未分類の場所に出す
    const key = item.categoryId !== null && known.has(item.categoryId) ? item.categoryId : null;
    const section = grouped.get(key);
    if (section) section.push(item);
    else grouped.set(key, [item]);
  }
  // 未分類は向きによらず最後に置く
  return [...order, null].flatMap((categoryId) => {
    const section = grouped.get(categoryId);
    return section ? [{ categoryId, items: section.sort(compareItems) }] : [];
  });
}

// 一覧をカテゴリのセクションに分ける。向きは表示だけで、order は変えない
export function sectionItems(input: SectionItemsInput): SectionedItems {
  const order = input.direction === "asc" ? input.order : [...input.order].reverse();
  return {
    unchecked: toSections(
      input.items.filter((item) => !item.checked),
      order,
    ),
    checked: toSections(
      input.items.filter((item) => item.checked),
      order,
    ),
  };
}
