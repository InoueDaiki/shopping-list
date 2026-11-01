// リスト画面の行。カテゴリの見出しと品目を、1本の FlatList に並べる形にする
import type { Id, Item, ItemSection, SectionedItems } from "@shopping-list/core";

export type ListRow =
  | { kind: "section"; key: string; categoryId: Id | null; count: number }
  | { kind: "checkedHeader"; key: string; count: number }
  | { kind: "item"; key: string; item: Item };

function sectionRows(sections: readonly ItemSection[], prefix: string): ListRow[] {
  return sections.flatMap(({ categoryId, items }) => [
    { kind: "section" as const, key: `${prefix}-${categoryId ?? "none"}`, categoryId, count: items.length },
    ...items.map((item) => ({ kind: "item" as const, key: item.id, item })),
  ]);
}

export function listRows({ unchecked, checked }: SectionedItems): ListRow[] {
  const count = checked.reduce((sum, section) => sum + section.items.length, 0);
  const rows = sectionRows(unchecked, "open");
  if (count > 0) {
    rows.push({ kind: "checkedHeader", key: "checked", count }, ...sectionRows(checked, "done"));
  }
  return rows;
}
