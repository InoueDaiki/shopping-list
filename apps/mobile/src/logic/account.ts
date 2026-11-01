// ログインしたアカウントと、端末の写しの持ち主を比べる。メールは SQLite にだけ置き、ログに出さない

// ok: 持ち主と同じ。adopt: 写しが無いので、このアカウントを持ち主にする。
// different: 別のアカウントの写し。unknown: 比べられない。どちらも確認を出す
export type AccountCheck = "ok" | "adopt" | "different" | "unknown";

export interface AccountCheckInput {
  // ログインしたアカウントのメール。取れなかったら undefined
  email: string | undefined;
  // 覚えている持ち主。null は覚えていない
  owner: string | null;
  hasLocalCopy: boolean;
}

// 保存する形。メールが取れなかったときは空にして、確認を毎回出さない
// (確認のたびに写しを消すことになる)。メールが取れるようになったら比べられないので確認を出す
export function ownerValue(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

export function accountCheck({ email, owner, hasLocalCopy }: AccountCheckInput): AccountCheck {
  if (owner === ownerValue(email)) return "ok";
  if (!hasLocalCopy) return "adopt";
  return owner !== null && owner !== "" && email !== undefined ? "different" : "unknown";
}
