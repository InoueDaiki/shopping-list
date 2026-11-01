// 外から開かれたパスを、画面のルートに直す。
// Google のログインの戻り先(io.github.inouedaiki.shoppinglist:/oauth2redirect)は expo-auth-session が受け取るが、
// Android では Expo Router にも届くので、一覧へ送る(無いパスの画面を出さない)
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^(?:[a-z][a-z0-9.+-]*:\/*)?\/?oauth2redirect(?:[/?#]|$)/i.test(path) ? "/" : path;
}
