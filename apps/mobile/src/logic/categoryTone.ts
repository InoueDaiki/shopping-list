// カテゴリの札の色。マスタの順に cat-1〜cat-8 を回す
import { masterOrder, type Category, type Id } from "@shopping-list/core";

const TONES = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6", "cat-7", "cat-8"] as const;

export type CategoryToneName = (typeof TONES)[number];

export function categoryToneMap(categories: readonly Category[]): ReadonlyMap<Id, CategoryToneName> {
  return new Map(masterOrder(categories).map((id, index) => [id, TONES[index % TONES.length] as CategoryToneName]));
}
