// 終わったトリップの品目を History へ移す計算。副作用を持たない
import {
  checksFromItems,
  groupTrips,
  historyEntriesFromTrip,
  isTripFinished,
  TRIP_GAP_MS,
  type HistoryEntry,
  type Id,
  type Iso,
  type Item,
  type LocalChange,
} from "@shopping-list/core";

// 店舗の無いチェックはトリップにならない。リストの無い品目(野良品目)はチェックできないので除く。同じ時間が過ぎたら移す(学習には使われない)。
// ID は core と同じく品目の ID にして、2台が同時に移しても読むときに重なるようにする
function storelessEntries(items: readonly Item[], now: Iso): HistoryEntry[] {
  const nowMs = Date.parse(now);
  return items
    .filter(
      (item): item is Item & { listId: Id } =>
        item.listId !== null &&
        item.checked &&
        item.checkedAt !== null &&
        item.checkedStoreId === null &&
        nowMs - Date.parse(item.checkedAt) > TRIP_GAP_MS,
    )
    .sort((a, b) => Date.parse(a.checkedAt as Iso) - Date.parse(b.checkedAt as Iso))
    .map((item, checkedSeq) => ({
      id: item.id,
      listId: item.listId,
      name: item.name,
      categoryId: item.categoryId,
      categorySource: item.categorySource,
      storeId: null,
      tripId: null,
      checkedAt: item.checkedAt as Iso,
      checkedSeq,
    }));
}

// 終わった品目を History に足し、Items から消す変更を返す
export function finishedTripChanges(items: readonly Item[], now: Iso): LocalChange[] {
  const entries = [
    ...groupTrips(checksFromItems(items))
      .filter((trip) => isTripFinished(trip, now))
      .flatMap((trip) => historyEntriesFromTrip(trip, items)),
    ...storelessEntries(items, now),
  ];
  return entries.flatMap((row): LocalChange[] => [
    { action: "put", table: "history", row },
    { action: "delete", table: "items", id: row.id, at: now },
  ]);
}
