// 終わったトリップの品目を History へ移す計算。副作用を持たない
import {
  checksFromItems,
  groupTrips,
  isTripFinished,
  TRIP_GAP_MS,
  type HistoryEntry,
  type Id,
  type Iso,
  type Item,
  type LocalChange,
} from "@shopping-list/core";

const MAX_ID_LENGTH = 64;

// 2台が同じトリップを同時に移しても、ローカルで1行に重なるよう、乱数でなく品目から作る
function derivedId(prefix: string, id: Id): Id {
  return `${prefix}${id}`.slice(0, MAX_ID_LENGTH);
}

function toHistory(item: Item, storeId: Id | null, tripId: Id | null, seq: number): HistoryEntry {
  return {
    id: derivedId("h_", item.id),
    listId: item.listId,
    name: item.name,
    categoryId: item.categoryId,
    storeId,
    tripId,
    checkedAt: item.checkedAt as Iso,
    checkedSeq: seq,
  };
}

// 終わったトリップの品目を History に足し、Items から消す変更を返す。
// 店舗の無いチェックはトリップにならないので、同じ時間が過ぎたら1件ずつ移す(学習には使われない)
export function finishedTripChanges(items: readonly Item[], now: Iso): LocalChange[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const changes: LocalChange[] = [];
  const move = (item: Item, storeId: Id | null, tripId: Id | null, seq: number) => {
    changes.push({ action: "put", table: "history", row: toHistory(item, storeId, tripId, seq) });
    changes.push({ action: "delete", table: "items", id: item.id, at: now });
  };

  for (const trip of groupTrips(checksFromItems(items))) {
    if (!isTripFinished(trip, now)) continue;
    const tripId = derivedId("t_", trip.checks[0].id);
    trip.checks.forEach((check, seq) => move(byId.get(check.id) as Item, trip.storeId, tripId, seq));
  }

  const nowMs = Date.parse(now);
  for (const item of items) {
    if (!item.checked || item.checkedAt === null || item.checkedStoreId !== null) continue;
    if (nowMs - Date.parse(item.checkedAt) > TRIP_GAP_MS) move(item, null, null, 0);
  }
  return changes;
}
