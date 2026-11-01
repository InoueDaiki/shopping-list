// シートを新しく作る、貼られたシートを開く。どちらも画面が待つ操作なので、失敗は原因の分かる文言にする
import { RemoteError, type RemoteErrorKind } from "@shopping-list/core";
import {
  beginSpreadsheet,
  ensureSpreadsheet,
  META_SHEET,
  parseSpreadsheetId,
  SCHEMA_VERSION,
  surveySpreadsheet,
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

function sheetRef(spreadsheetId: string): SheetRef {
  return { spreadsheetId, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}

// 書き込みの 403 を閲覧だけの権限として扱う。読み取りは通るので、書いてみないと分からない
async function requireWrite(task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    if (error instanceof RemoteError && error.kind === "forbidden") throw new ReadOnlySheetError();
    throw error;
  }
}

// 作りかけのシート。途中で失敗したら、次の作成がこのシートの続きを行う
interface SheetDraft {
  spreadsheetId: string;
  spreadsheetUrl: string;
  defaultSheetId: number;
}

export interface SheetDraftStore {
  load(): string | null;
  save(value: string | null): void;
}

// シートが消された、持ち主のアカウントが違う、手で変えられた、といった続けられない失敗
const DRAFT_LOST: readonly RemoteErrorKind[] = ["notFound", "forbidden", "schema"];

async function finishDraft(client: SheetsClient, drafts: SheetDraftStore, draft: SheetDraft): Promise<SheetRef> {
  await ensureSpreadsheet(client, draft.spreadsheetId, { defaultSheetId: draft.defaultSheetId });
  drafts.save(null);
  return { spreadsheetId: draft.spreadsheetId, spreadsheetUrl: draft.spreadsheetUrl };
}

// 新しいシートを作る。作った ID を先に保存し、初期化に失敗しても次はそのシートへ続きを行う
export async function createSheet(client: SheetsClient, drafts: SheetDraftStore): Promise<SheetRef> {
  const stored = drafts.load();
  if (stored !== null) {
    try {
      return await finishDraft(client, drafts, JSON.parse(stored) as SheetDraft);
    } catch (error) {
      if (!(error instanceof RemoteError) || !DRAFT_LOST.includes(error.kind)) throw error;
      drafts.save(null);
    }
  }
  const draft = await beginSpreadsheet(client, SPREADSHEET_TITLE);
  drafts.save(JSON.stringify(draft));
  return finishDraft(client, drafts, draft);
}

export type OpenedSheet =
  | { kind: "ready"; sheet: SheetRef }
  // アプリの形ではない。確認のうえ initSheet で足す
  | { kind: "needsInit"; spreadsheetId: string; missing: readonly string[] };

// 貼られたシートを調べる。シートの形が足りなければ、まだ何も書かずに needsInit を返す。
// 同じ名前のシートの列が違えば、RemoteError(schema)に原因を入れて投げる
export async function openExistingSheet(client: SheetsClient, urlOrId: string): Promise<OpenedSheet> {
  const spreadsheetId = parseSpreadsheetId(parseInviteLink(urlOrId) ?? urlOrId);
  if (spreadsheetId === null) throw new RemoteError("invalid", "スプレッドシートの URL ではない");
  const { missing } = await surveySpreadsheet(client, spreadsheetId);
  if (missing.length > 0) return { kind: "needsInit", spreadsheetId, missing };
  // spreadsheets のスコープでは権限を読めない。同じ値を書き戻して、書けるかだけを確かめる
  await requireWrite(() => client.valuesBatchUpdate(spreadsheetId, [{ range: `${META_SHEET.name}!A2`, values: [[SCHEMA_VERSION]] }]));
  return { kind: "ready", sheet: sheetRef(spreadsheetId) };
}

// 足りないシートを足して初期化する。あるシートには触らない
export async function initSheet(client: SheetsClient, spreadsheetId: string): Promise<SheetRef> {
  await requireWrite(() => ensureSpreadsheet(client, spreadsheetId));
  return sheetRef(spreadsheetId);
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
        return `このシートは使えないので、何も変えずに止めました(${error.message})。別のスプレッドシートを使うか、シートの名前を変えてからもう一度試してください。`;
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
