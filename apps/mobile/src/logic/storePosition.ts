// 登録のときに保存した位置と、測り終えた位置を比べる
import type { GeoPoint } from "@shopping-list/core";

// 保存し直す位置を返す。測れなかった、または同じ位置なら null
export function refinedPosition(saved: GeoPoint | null, measured: GeoPoint | null): GeoPoint | null {
  if (!measured) return null;
  return saved?.lat === measured.lat && saved.lng === measured.lng ? null : measured;
}
