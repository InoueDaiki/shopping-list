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
    // 配布のたびに増やす。端末は小さい値では上書きしない
    versionCode: 1,
    permissions: ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"],
    // テンプレートが入れるが使わない権限。バイブレーションを使うときは VIBRATE を外す
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.VIBRATE",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
      "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    "expo-sqlite",
    "expo-location",
    [
      "expo-build-properties",
      {
        // 配布物を軽くする(docs/設計メモ.md の「配布」)。JS は Hermes(既定)
        android: {
          buildArchs: ["arm64-v8a"],
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          // React Native の Image で GIF と WebP を使わないので、Fresco の分を入れない
          gifEnabled: false,
          webpEnabled: false,
        },
      },
    ],
    "./plugins/with-release-signing.js",
  ],
  extra: {
    googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    // EXPO_PUBLIC_DEMO=1 でビルドすると、シート無しで動く(エミュレーターの確認と E2E 用)
    demo: process.env.EXPO_PUBLIC_DEMO === "1",
  },
});
