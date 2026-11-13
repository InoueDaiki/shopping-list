// 起動したときに見せる画面を決める。ふだんはログインを待たずに一覧を出す(アプリ内のリストはログインが要らない)。
// 招待リンクから開いたときだけ、ログインと確認を先に出す

// app: 一覧。join: 招待の確認。signIn: 招待を開くためのログイン。wait: ログインの状態を確かめている
export type Entry = "app" | "join" | "signIn" | "wait";

export interface EntryInput {
  demo: boolean;
  // 開かれた招待リンクがある
  invited: boolean;
  auth: "loading" | "signedOut" | "signingIn" | "signedIn";
  // 端末の写しが別のアカウントのものかもしれず、確認を出している
  blocked: boolean;
}

export function entryScreen({ demo, invited, auth, blocked }: EntryInput): Entry {
  if (demo || !invited) return "app";
  if (auth === "loading") return "wait";
  // 招待の確認は、ログインと写しの持ち主の確認の後に出す
  return auth === "signedIn" && !blocked ? "join" : "signIn";
}
