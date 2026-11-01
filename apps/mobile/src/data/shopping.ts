// 買い物の間だけの状態(今の店舗、見る向き)。端末だけのもので、シートへ送らない
import {
  setDirectionManually,
  startTripDirection,
  TRIP_GAP_MS,
  tripCategorySequence,
  updateDirection,
  type Id,
  type Iso,
  type Item,
  type ListDirection,
  type TripDirection,
} from "@shopping-list/core";

export interface ShoppingSession {
  storeId: Id | null;
  // 始まった時刻。これより後のチェックがこのトリップの分
  startedAt: Iso;
  // 最後に操作した時刻(チェックと店舗の選択)。ここから時間が空くと終わる
  touchedAt: Iso;
  direction: TripDirection;
}

export function startSession(now: Iso, storeId: Id | null = null): ShoppingSession {
  return { storeId, startedAt: now, touchedAt: now, direction: startTripDirection() };
}

export function activeSession(session: ShoppingSession | null, now: Iso): ShoppingSession | null {
  if (!session) return null;
  return Date.parse(now) - Date.parse(session.touchedAt) <= TRIP_GAP_MS ? session : null;
}

// このトリップで今の店舗についたチェックのカテゴリの順
function visitedCategories(items: readonly Item[], session: ShoppingSession): Id[] {
  const startedAt = Date.parse(session.startedAt);
  const checks = items
    .filter(
      (item) =>
        item.checked && item.checkedAt !== null && item.checkedStoreId === session.storeId && Date.parse(item.checkedAt) >= startedAt,
    )
    .map((item) => ({ id: item.id, storeId: item.checkedStoreId, categoryId: item.categoryId, checkedAt: item.checkedAt as Iso }))
    .sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
  return tripCategorySequence({ storeId: session.storeId ?? "", startedAt: session.startedAt, endedAt: session.touchedAt, checks });
}

// チェックのたびに向きを見直す。店舗が決まっていなければ比べる順番が無い
export function reviewDirection(session: ShoppingSession, order: readonly Id[], items: readonly Item[]): ShoppingSession {
  if (session.storeId === null) return session;
  const direction = updateDirection(session.direction, order, visitedCategories(items, session));
  return direction === session.direction ? session : { ...session, direction };
}

export function withManualDirection(session: ShoppingSession, direction: ListDirection): ShoppingSession {
  return { ...session, direction: setDirectionManually(session.direction, direction) };
}
