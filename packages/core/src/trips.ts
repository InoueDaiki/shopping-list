import { TRIP_GAP_MS } from "./constants.ts";
import type { HistoryEntry, Id, Iso, Item } from "./types.ts";

// チェックの記録。HistoryEntry はこの形を満たす。Item は checksFromItems で写す
export interface CheckRecord {
  id: Id;
  storeId: Id | null;
  categoryId: Id | null;
  checkedAt: Iso;
  checkedSeq?: number;
}

export interface Trip<T extends CheckRecord = CheckRecord> {
  storeId: Id;
  startedAt: Iso;
  endedAt: Iso;
  // チェックの順
  checks: T[];
}

// チェック済みの品目をチェックの記録にする。チェックを外したものはここで落ちる
export function checksFromItems(items: readonly Item[]): CheckRecord[] {
  const checks: CheckRecord[] = [];
  for (const item of items) {
    if (!item.checked || item.checkedAt === null) continue;
    checks.push({
      id: item.id,
      storeId: item.checkedStoreId,
      categoryId: item.categoryId,
      checkedAt: item.checkedAt,
    });
  }
  return checks;
}

function compareChecks(a: CheckRecord, b: CheckRecord): number {
  return (
    Date.parse(a.checkedAt) - Date.parse(b.checkedAt) ||
    (a.checkedSeq ?? 0) - (b.checkedSeq ?? 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// チェックをトリップにまとめ、始まった順に返す。店舗の無いチェックは学習しないので除く。
// 「前のチェック」は同じ店舗の中で見る。2人が別の店舗で同時に買っても混ざらない
export function groupTrips<T extends CheckRecord>(checks: readonly T[]): Trip<T>[] {
  const sorted = checks.filter((check) => check.storeId !== null).sort(compareChecks);
  const trips: Trip<T>[] = [];
  const openTrips = new Map<Id, Trip<T>>();
  for (const check of sorted) {
    const storeId = check.storeId as Id;
    const open = openTrips.get(storeId);
    if (open && Date.parse(check.checkedAt) - Date.parse(open.endedAt) <= TRIP_GAP_MS) {
      open.checks.push(check);
      open.endedAt = check.checkedAt;
      continue;
    }
    const trip: Trip<T> = {
      storeId,
      startedAt: check.checkedAt,
      endedAt: check.checkedAt,
      checks: [check],
    };
    trips.push(trip);
    openTrips.set(storeId, trip);
  }
  return trips;
}

// 最後のチェックから、まとめられる時間を過ぎていれば終わっている
export function isTripFinished(trip: Trip, now: Iso): boolean {
  return Date.parse(now) - Date.parse(trip.endedAt) > TRIP_GAP_MS;
}

// トリップの ID。最初のチェックの ID をそのまま使うので、どの端末で計算しても同じになる
export function tripIdOf(trip: Trip): Id {
  return trip.checks[0].id;
}

// 終わったトリップの品目を履歴の行にする。履歴の ID は品目の ID にするので、2台が同じ
// トリップを移しても重ならない(読むときに ID で重ねる)。items に無いチェックは除く
export function historyEntriesFromTrip(trip: Trip, items: readonly Item[]): HistoryEntry[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const tripId = tripIdOf(trip);
  return trip.checks.flatMap((check, checkedSeq) => {
    const item = itemsById.get(check.id);
    if (item === undefined) return [];
    return [
      {
        id: item.id,
        listId: item.listId,
        name: item.name,
        categoryId: item.categoryId,
        categorySource: item.categorySource,
        storeId: trip.storeId,
        tripId,
        checkedAt: check.checkedAt,
        checkedSeq,
      },
    ];
  });
}

// カテゴリごとの最初のチェックの順。未分類は順番に関わらないので除く
export function tripCategorySequence(trip: Trip): Id[] {
  const sequence = new Set<Id>();
  for (const check of trip.checks) {
    if (check.categoryId !== null) sequence.add(check.categoryId);
  }
  return [...sequence];
}

// カテゴリが変わるところのチェックの間隔の中央値。変わるところが無ければ null。
// 同じ売り場で続けて買うと間隔が短くなるので、全部のチェックの間隔は見ない
export function medianCategoryGapMs(trip: Trip): number | null {
  const gaps: number[] = [];
  let previous: CheckRecord | null = null;
  for (const check of trip.checks) {
    if (check.categoryId === null) continue;
    if (previous && previous.categoryId !== check.categoryId) {
      gaps.push(Date.parse(check.checkedAt) - Date.parse(previous.checkedAt));
    }
    previous = check;
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
}
