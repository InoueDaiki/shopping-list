import { RemoteError } from "@shopping-list/core";
import { openSpreadsheet, type SheetsClient } from "@shopping-list/sheets";
import { describe, expect, it, vi } from "vitest";

import { openExistingSheet, ReadOnlySheetError, sheetErrorMessage } from "./spreadsheet.ts";

const ID = "abcdefghijklmnopqrstuvwxyz012345";
const URL = `https://docs.google.com/spreadsheets/d/${ID}/edit`;

vi.mock("@shopping-list/sheets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shopping-list/sheets")>()),
  openSpreadsheet: vi.fn(async () => ({ spreadsheetId: ID })),
}));

function client(valuesBatchUpdate: () => Promise<unknown>): SheetsClient {
  return { valuesBatchUpdate } as unknown as SheetsClient;
}

describe("openExistingSheet", () => {
  it("書けるシートを開く", async () => {
    const write = vi.fn(async () => ({}));
    await expect(openExistingSheet(client(write), URL)).resolves.toEqual({ spreadsheetId: ID, spreadsheetUrl: URL });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("招待リンクも受け付ける", async () => {
    await openExistingSheet(client(async () => ({})), `shoppinglist://join?sheet=${ID}`);
    expect(vi.mocked(openSpreadsheet).mock.lastCall?.[1]).toBe(ID);
  });

  it("読めるが書けないシートは閲覧だけとして止める", async () => {
    const write = async () => {
      throw new RemoteError("forbidden", "403");
    };
    await expect(openExistingSheet(client(write), URL)).rejects.toBeInstanceOf(ReadOnlySheetError);
  });

  it("書き込みのほかの失敗はそのまま伝える", async () => {
    const write = async () => {
      throw new RemoteError("offline", "つながらない");
    };
    await expect(openExistingSheet(client(write), URL)).rejects.toMatchObject({ kind: "offline" });
  });
});

describe("sheetErrorMessage", () => {
  it("閲覧だけの権限を原因として伝える", () => {
    expect(sheetErrorMessage(new ReadOnlySheetError(), URL)).toContain("閲覧だけ");
  });

  it("URL でないものを貼ったときを伝える", () => {
    expect(sheetErrorMessage(new RemoteError("invalid", "x"), "こんにちは")).toContain("URL ではありません");
  });

  it("アプリの形でないシートを伝える", () => {
    expect(sheetErrorMessage(new RemoteError("schema", "x"), URL)).toContain("アプリの形ではありません");
  });

  it.each([
    ["forbidden", "権限がありません"],
    ["notFound", "見つかりません"],
    ["offline", "つながりません"],
    ["auth", "ログイン"],
    ["server", "混み合って"],
  ] as const)("%s の文言", (kind, text) => {
    expect(sheetErrorMessage(new RemoteError(kind, "x"), URL)).toContain(text);
  });
});
