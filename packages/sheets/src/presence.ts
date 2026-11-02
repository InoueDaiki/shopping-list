// 在室の記録と変更の印。同期の表とは別の、小さな読み書き。
// 2人が同じリストを開いている間だけ、印と在室を短い間隔で読み、印が変わったときにだけ全部を読む。

import type { Cell } from "./client.ts";
import { isId, isIso } from "./codec.ts";

export interface PresenceRow {
  deviceId: string;
  listId: string;
  // この時刻まで画面を開いている。画面を離れたら離れた時刻にする
  until: string;
  updatedAt: string;
  // シートの行の番号(1始まり)
  rowNumber: number;
}

// 速い読み取りの結果
export interface Peek {
  // 前回の全部の読み取りの後に、ほかの端末が書いた
  changed: boolean;
  presence: PresenceRow[];
}

// 読めない行は飛ばす。在室は失っても困らないので、画面では知らせない
export function decodePresence(values: readonly Cell[][], firstRow = 2): PresenceRow[] {
  return values.flatMap((cells, offset) => {
    const [deviceId, listId, until, updatedAt] = cells;
    if (!isId(deviceId) || !isId(listId) || !isIso(until) || !isIso(updatedAt)) return [];
    return [{ deviceId, listId, until, updatedAt, rowNumber: firstRow + offset }];
  });
}

// 印を作る。書くたびに必ず変わるよう、時刻と端末の ID をつなぐ
export function writeMarker(at: string, deviceId: string): string {
  return `${at}/${deviceId}`;
}

export interface MarkerState {
  // 前回の全部の読み取りで見た印。まだ読んでいなければ undefined
  seen: string | null | undefined;
  // 自分が最後に書いた印
  own: string | null;
}

// 前回の全部の読み取りの後に、ほかの端末が書いたか。2台が同時に書いても、残ったほうの印が
// 前回と違えば分かる。自分の書いた印は、中身が手元にあるので無視する
export function markerChanged(marker: string | null, { seen, own }: MarkerState): boolean {
  if (seen === undefined) return true;
  if (marker === seen) return false;
  return marker === null || marker !== own;
}
