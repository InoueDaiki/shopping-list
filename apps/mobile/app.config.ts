// Expo の設定。GOOGLE_OAUTH_CLIENT_ID は .env から読む(mise が読み込む)
import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "買い物リスト",
  slug: "shopping-list",
  version: "0.1.0",
  scheme: "shoppinglist",
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
  },
});
