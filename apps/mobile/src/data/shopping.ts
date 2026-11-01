// 買い物の間だけの状態(今の店舗、見る向き)。端末だけのもので、シートへ送らない
import {
  setDirectionManually,
  startTripDirection,
  STORE_CORRECTION_MS,
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
  const checks = sessionChecks(items, session)
    .map((item) => ({ id: item.id, storeId: item.checkedStoreId, categoryId: item.categoryId, checkedAt: item.checkedAt as Iso }))
    .sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
  return tripCategorySequence({ storeId: session.storeId ?? "", startedAt: session.startedAt, endedAt: session.touchedAt, checks });
}

// このトリップで今の店舗についたチェックの品目
export function sessionChecks(items: readonly Item[], session: ShoppingSession): Item[] {
  const startedAt = Date.parse(session.startedAt);
  return items.filter(
    (item) => item.checked && item.checkedAt !== null && item.checkedStoreId === session.storeId && Date.parse(item.checkedAt) >= startedAt,
  );
}

// 店舗を替えるとき、今のトリップのチェックを付け替えるか。最後のチェックから時間が
// たっていれば訂正ではなく次の店舗へ移ったので、前のチェックはそのままにする
export function isStoreCorrection(checks: readonly Item[], now: Iso): boolean {
  const last = Math.max(...checks.map((item) => Date.parse(item.checkedAt as Iso)));
  return Date.parse(now) - last <= STORE_CORRECTION_MS;
}

// チェックのたびに向きを見直す。order は学んだ順番で、店舗が決まっていないときと
// 順番を学んでいないとき(null)は比べる相手が無い(マスタの順は売り場の向きと関係がない)
export function reviewDirection(session: ShoppingSession, order: readonly Id[] | null, items: readonly Item[]): ShoppingSession {
  if (session.storeId === null || order === null) return session;
  const direction = updateDirection(session.direction, order, visitedCategories(items, session));
  return direction === session.direction ? session : { ...session, direction };
}

export function withManualDirection(session: ShoppingSession, direction: ListDirection): ShoppingSession {
  return { ...session, direction: setDirectionManually(session.direction, direction) };
}
