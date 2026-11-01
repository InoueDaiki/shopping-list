// 表ごとの違い(主キーと版の列)をここに閉じ込める。

import type { Id, Iso } from "../types.ts";
import type { LocalChange, RowOf } from "./types.ts";

export function rowId(change: RowOf): Id {
  return change.table === "storeOrders" ? change.row.storeId : change.row.id;
}

// 後勝ちに使う版。Lists、Categories、Stores は時刻の列を持たないので null
export function rowVersion(change: RowOf): Iso | null {
  if (change.table === "items") return change.row.updatedAt;
  if (change.table === "storeOrders") return change.row.editedAt;
  return null;
}

export function changeId(change: LocalChange): Id {
  return change.action === "put" ? rowId(change) : change.id;
}

// 表と ID の組の文字列。送信待ちの突き合わせに使う
export function changeKey(change: LocalChange): string {
  return `${change.table}\0${changeId(change)}`;
}

// 時刻の比較。文字列の形(ミリ秒の有無)が違っても正しく比べる
export function compareIso(a: Iso, b: Iso): number {
  return Date.parse(a) - Date.parse(b);
}
