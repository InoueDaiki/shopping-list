// 店舗の位置の入力。Google マップの長押しでコピーした「緯度, 経度」の形を読む
import type { GeoPoint } from "@shopping-list/core";

// 全角の数字やコンマは NFKC で半角にしてから読む
const COORDINATES = /^([+-]?\d+(?:\.\d+)?)\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)$/;

// 形が違うときと、緯度と経度の範囲の外のときは null
export function parseCoordinates(text: string): GeoPoint | null {
  const match = COORDINATES.exec(text.normalize("NFKC").trim());
  if (!match) return null;
  const [lat, lng] = [Number(match[1]), Number(match[2])];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

// 小数6桁でおよそ 10cm。店舗の位置には十分
export function formatCoordinates({ lat, lng }: GeoPoint): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

// 地図のアプリを開く URL。q を付けると、その位置にピンが立つ
export function geoUrl({ lat, lng }: GeoPoint): string {
  return `geo:${lat},${lng}?q=${lat},${lng}`;
}
