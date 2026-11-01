// シートを新しく作る、貼られたシートを開く。どちらも画面が待つ操作なので、失敗は原因の分かる文言にする
import { RemoteError } from "@shopping-list/core";
import {
  createSpreadsheet,
  META_SHEET,
  openSpreadsheet,
  parseSpreadsheetId,
  SCHEMA_VERSION,
  type SheetsClient,
} from "@shopping-list/sheets";

import { parseInviteLink } from "../logic/invite.ts";

export const SPREADSHEET_TITLE = "買い物リスト";

export interface SheetRef {
  spreadsheetId: string;
  spreadsheetUrl: string;
}

// 閲覧だけの権限のときに投げる。読み取りは通るので、書いてみないと分からない
export class ReadOnlySheetError extends Error {
  override name = "ReadOnlySheetError";
  constructor() {
    super("シートへの書き込みの権限が無い");
  }
}

export function createSheet(client: SheetsClient): Promise<SheetRef> {
  return createSpreadsheet(client, SPREADSHEET_TITLE);
}

export async function openExistingSheet(client: SheetsClient, urlOrId: string): Promise<SheetRef> {
  const { spreadsheetId } = await openSpreadsheet(client, parseInviteLink(urlOrId) ?? urlOrId);
  try {
    // spreadsheets のスコープでは権限を読めない。同じ値を書き戻して、書けるかだけを確かめる
    await client.valuesBatchUpdate(spreadsheetId, [{ range: `${META_SHEET.name}!A2`, values: [[SCHEMA_VERSION]] }]);
  } catch (error) {
    if (error instanceof RemoteError && error.kind === "forbidden") throw new ReadOnlySheetError();
    throw error;
  }
  return { spreadsheetId, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}

export function sheetErrorMessage(error: unknown, input = ""): string {
  if (error instanceof ReadOnlySheetError) {
    return "このシートは閲覧だけの権限です。シートの持ち主に「編集者」の権限をもらってから、もう一度開いてください。";
  }
  if (input !== "" && parseInviteLink(input) === null && parseSpreadsheetId(input) === null) {
    return "スプレッドシートの URL ではありません。ブラウザのアドレス欄の URL をそのまま貼ってください。";
  }
  if (error instanceof RemoteError) {
    switch (error.kind) {
      case "schema":
        return "このシートは買い物リストのアプリの形ではありません。アプリで作ったシートの URL を貼ってください。";
      case "forbidden":
        return "このシートを開く権限がありません。シートの持ち主に、このアカウントへ「編集者」として共有するよう頼んでください。";
      case "notFound":
        return "シートが見つかりません。URL が正しいか、シートが削除されていないかを確かめてください。";
      case "offline":
        return "つながりません。通信できる場所でもう一度試してください。";
      case "auth":
        return "ログインが切れました。ログインし直してください。";
      case "rateLimited":
      case "server":
        return "Google のサーバーが混み合っています。少し待ってからもう一度試してください。";
      case "invalid":
        return "このファイルは開けません。Google スプレッドシートの URL を貼ってください。";
    }
  }
  return "シートを開けませんでした。もう一度試してください。";
}
