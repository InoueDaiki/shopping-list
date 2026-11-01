// 表ごとの違い(主キーと版の列)をここに閉じ込める。

import type { Id, Iso } from "../types.ts";
import type { LocalChange, RowOf } from "./types.ts";

export function rowId(change: RowOf): Id {
  return change.table === "storeOrders" ? change.row.storeId : change.row.id;
}

// 後勝ちに使う版。History は書き換えないので版を持たない
export function rowVersion(change: RowOf): Iso | null {
  if (change.table === "history") return null;
  return change.table === "storeOrders" ? change.row.editedAt : change.row.updatedAt;
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

// 行の版と墓石の時刻の新しいほう。リモートの行の版はこれにする
export function newestVersion(version: Iso | null, deletedAt: Iso | null): Iso | null {
  if (version === null || deletedAt === null) return version ?? deletedAt;
  return compareIso(deletedAt, version) > 0 ? deletedAt : version;
}

// 墓石が効いているか。墓石より新しい版が書かれた行は生きている。
// 墓石は deleted_at の1セルだけ、更新は行全体を書くので、どちらが先に届いても同じ結果になる
export function isTombstoned(version: Iso | null, deletedAt: Iso | null): boolean {
  if (deletedAt === null) return false;
  return version === null || compareIso(deletedAt, version) >= 0;
}
