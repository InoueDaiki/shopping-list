// Expo の設定。GOOGLE_OAUTH_CLIENT_ID は .env から読む(mise が読み込む)
import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "買い物リスト",
  slug: "shopping-list",
  version: "0.1.0",
  // 2つ目は Google の OAuth の戻り先(Android クライアントの慣習。パッケージ名の逆ドメイン)
  scheme: ["shoppinglist", "io.github.inouedaiki.shoppinglist"],
  orientation: "portrait",
  // 明暗は OS の設定に従う(トークンが切り替える)
  userInterfaceStyle: "automatic",
  android: {
    package: "io.github.inouedaiki.shoppinglist",
    permissions: ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"],
  },
  plugins: ["expo-router", "expo-secure-store", "expo-web-browser", "expo-sqlite", "expo-location"],
  extra: {
    googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    // EXPO_PUBLIC_DEMO=1 でビルドすると、シート無しで動く(エミュレーターの確認と E2E 用)
    demo: process.env.EXPO_PUBLIC_DEMO === "1",
  },
});
