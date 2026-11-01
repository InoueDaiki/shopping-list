import { EARTH_RADIUS_M, NEARBY_STORE_RADIUS_M } from "./constants.ts";
import type { CheckRecord } from "./trips.ts";
import type { Id, Iso, Store } from "./types.ts";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface StoreCandidate {
  store: Store;
  // 今の位置か店舗の位置が無ければ null
  distanceM: number | null;
  nearby: boolean;
}

export interface StoreCandidatesInput {
  stores: readonly Store[];
  // 位置の許可が無いときは null
  position: GeoPoint | null;
  // 店舗の ID から最後に使った日時へ。storeLastUsed で作れる
  lastUsed: ReadonlyMap<Id, Iso>;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// チェックの記録から店舗ごとの最後の利用日時を作る
export function storeLastUsed(checks: readonly CheckRecord[]): Map<Id, Iso> {
  const lastUsed = new Map<Id, Iso>();
  for (const { storeId, checkedAt } of checks) {
    if (storeId === null) continue;
    const current = lastUsed.get(storeId);
    if (current === undefined || Date.parse(checkedAt) > Date.parse(current)) {
      lastUsed.set(storeId, checkedAt);
    }
  }
  return lastUsed;
}

function distanceTo(store: Store, position: GeoPoint | null): number | null {
  if (position === null || store.lat === null || store.lng === null) return null;
  return haversineDistanceM(position, { lat: store.lat, lng: store.lng });
}

// 近い店舗を距離の順に上へ出し、残りは最近使った順にする。使ったことの無い店舗は
// 新しく登録した順で後ろに置く。全部の店舗を返すので、どれでも選べる
export function storeCandidates(input: StoreCandidatesInput): StoreCandidate[] {
  const candidates = input.stores.map((store) => {
    const distanceM = distanceTo(store, input.position);
    return { store, distanceM, nearby: distanceM !== null && distanceM <= NEARBY_STORE_RADIUS_M };
  });
  const usedAt = (store: Store): number => {
    const iso = input.lastUsed.get(store.id);
    return iso === undefined ? -Infinity : Date.parse(iso);
  };
  return candidates.sort((a, b) => {
    if (a.nearby !== b.nearby) return a.nearby ? -1 : 1;
    if (a.nearby) {
      const byDistance = (a.distanceM as number) - (b.distanceM as number);
      if (byDistance !== 0) return byDistance;
    }
    const [usedA, usedB] = [usedAt(a.store), usedAt(b.store)];
    if (usedA !== usedB) return usedB > usedA ? 1 : -1;
    return (
      Date.parse(b.store.createdAt) - Date.parse(a.store.createdAt) ||
      (a.store.id < b.store.id ? -1 : a.store.id > b.store.id ? 1 : 0)
    );
  });
}
