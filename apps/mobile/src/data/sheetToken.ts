// auth.ts の失敗を、SheetsClient の分かる形(RemoteError)に直す
import { RemoteError } from "@shopping-list/core";
import type { GetAccessToken } from "@shopping-list/sheets";

// auth.ts の LoginRequiredError。expo の端末 API を読み込まないよう、名前で見分ける
function isLoginRequired(error: unknown): boolean {
  return error instanceof Error && error.name === "LoginRequiredError";
}

export function sheetTokenProvider(getToken: (options: { forceRefresh: boolean }) => Promise<string>): GetAccessToken {
  return async (options) => {
    try {
      return await getToken(options);
    } catch (error) {
      if (isLoginRequired(error)) throw new RemoteError("auth", "ログインが必要です");
      // リフレッシュの通信の失敗。ログインは保たれている
      throw new RemoteError("offline", "アクセストークンを更新できない");
    }
  };
}
