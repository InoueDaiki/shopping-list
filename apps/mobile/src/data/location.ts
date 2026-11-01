// 今の位置。許可は使用中のみ。無くても店舗は選べるので、失敗は null にする
import type { GeoPoint } from "@shopping-list/core";
import { Accuracy, getCurrentPositionAsync, getLastKnownPositionAsync, requestForegroundPermissionsAsync } from "expo-location";

function toPoint(position: { coords: { latitude: number; longitude: number } }): GeoPoint {
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

// 分かった位置を順に知らせる。まず前回の位置を出し、測れたら置き換える
export async function watchPositionOnce(onPosition: (point: GeoPoint) => void): Promise<GeoPoint | null> {
  try {
    const { granted } = await requestForegroundPermissionsAsync();
    if (!granted) return null;
    const last = await getLastKnownPositionAsync();
    if (last) onPosition(toPoint(last));
    // 店舗を選ぶ途中に OS の設定のダイアログを重ねない
    const current = toPoint(await getCurrentPositionAsync({ accuracy: Accuracy.Balanced, mayShowUserSettingsDialog: false }));
    onPosition(current);
    return current;
  } catch (error) {
    console.info("位置を取れなかった", error);
    return null;
  }
}
