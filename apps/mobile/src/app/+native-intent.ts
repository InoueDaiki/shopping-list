// 外から開かれたパスを、画面のルートに直す。
// Google のログインの戻り先(io.github.inouedaiki.shoppinglist:/oauth2redirect)は expo-auth-session が受け取るが、
// Android では Expo Router にも届くので、一覧へ送る(無いパスの画面を出さない)。
// 招待リンクは端末に覚えて一覧へ送る。ログインをはさんでも(その間にアプリが落ちても)消えず、
// いちばん外のレイアウトが join の画面を出す
import { config } from "../config.ts";
import { rememberInvite } from "../data/runtime.ts";
import { isJoinPath, parseInviteLink } from "../logic/invite.ts";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (isJoinPath(path)) {
    const spreadsheetId = parseInviteLink(path);
    if (spreadsheetId !== null && !config.demo) rememberInvite(spreadsheetId);
    return "/";
  }
  return /^(?:[a-z][a-z0-9.+-]*:\/*)?\/?oauth2redirect(?:[/?#]|$)/i.test(path) ? "/" : path;
}
