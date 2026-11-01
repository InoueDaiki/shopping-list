// 招待リンク(shoppinglist://join?sheet=<シートID>)。シート ID を持つので、ログや解析に出さない
const LINK_RE = /^(?:shoppinglist:\/\/|\/)?join\/?\?(?:[^#]*&)?sheet=([A-Za-z0-9_-]{25,})(?:[&#]|$)/;
// join の形か(ID が不正なものも含む)
const JOIN_PATH_RE = /^(?:shoppinglist:\/\/|\/)?join(?:[/?#]|$)/;

export function inviteLink(spreadsheetId: string): string {
  return `shoppinglist://join?sheet=${spreadsheetId}`;
}

// 招待リンクからシートの ID を取り出す。この形でなければ null
export function parseInviteLink(input: string): string | null {
  return LINK_RE.exec(input.trim())?.[1] ?? null;
}

export function isJoinPath(path: string): boolean {
  return JOIN_PATH_RE.test(path);
}

export function inviteMessage({ spreadsheetId, spreadsheetUrl }: { spreadsheetId: string; spreadsheetUrl: string }): string {
  return [
    "買い物リストのアプリに招待します。",
    "編集の権限を渡したら、このリンクをアプリで開いてください。開けないときは、アプリのシートの設定にリンクを貼ってください。",
    inviteLink(spreadsheetId),
    "",
    "シート:",
    spreadsheetUrl,
  ].join("\n");
}
