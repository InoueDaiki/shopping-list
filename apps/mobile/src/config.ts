// ビルドのときに埋め込む設定(app.config.ts の extra)
import Constants from "expo-constants";

interface Extra {
  googleOAuthClientId?: string;
}

const extra = Constants.expoConfig?.extra as Extra | undefined;

export const config = {
  // 空ならログインできない。signIn が「設定されていない」と画面に伝える
  googleOAuthClientId: extra?.googleOAuthClientId ?? "",
};
