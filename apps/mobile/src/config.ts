// ビルドのときに埋め込む設定(app.config.ts の extra)
import Constants from "expo-constants";

interface Extra {
  googleOAuthClientId?: string;
  demo?: boolean;
}

const extra = Constants.expoConfig?.extra as Extra | undefined;

export const config = {
  // 空ならログインできない。signIn が「設定されていない」と画面に伝える
  googleOAuthClientId: extra?.googleOAuthClientId ?? "",
  // true ならログインもシートも使わず、端末の中だけで動く
  demo: extra?.demo === true,
};
