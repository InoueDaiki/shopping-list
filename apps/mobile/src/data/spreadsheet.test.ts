import { RemoteError } from "@shopping-list/core";
import { SCHEMA_VERSION, SHEETS, type SheetsClient } from "@shopping-list/sheets";
import { describe, expect, it, vi } from "vitest";

import { createSheet, initSheet, openExistingSheet, ReadOnlySheetError, sheetErrorMessage } from "./spreadsheet.ts";

const ID = "abcdefghijklmnopqrstuvwxyz012345";
const URL = `https://docs.google.com/spreadsheets/d/${ID}/edit`;

const OK_HEADER = (name: string) => SHEETS.find((def) => def.name === name)?.columns.map((column) => column.name);

interface FakeOptions {
  titles?: string[];
  write?: () => Promise<unknown>;
  batchUpdate?: () => Promise<unknown>;
  create?: () => Promise<unknown>;
}

// 調べるときの読み取りを、アプリの形のシートとして返す
function client({ titles = SHEETS.map((def) => def.name), write, batchUpdate, create }: FakeOptions = {}) {
  return {
    get: async () => ({ sheets: titles.map((title, index) => ({ properties: { sheetId: index + 1, title } })) }),
    batchGet: async (_id: string, ranges: string[]) =>
      ranges.map((range) => ({
        values: range.endsWith("!A2") ? [[SCHEMA_VERSION]] : [OK_HEADER(range.split("!")[0] as string)],
      })),
    valuesBatchUpdate: write ?? (async () => ({})),
    batchUpdate: batchUpdate ?? (async () => ({})),
    create: create ?? (async () => ({ spreadsheetId: ID, sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }] })),
  } as unknown as SheetsClient;
}

function memoryDrafts(initial: string | null = null) {
  let value = initial;
  return {
    load: () => value,
    save: (next: string | null) => {
      value = next;
    },
  };
}

const forbidden = async () => {
  throw new RemoteError("forbidden", "403");
};

describe("openExistingSheet", () => {
  it("書けるシートを開く", async () => {
    const write = vi.fn(async () => ({}));
    await expect(openExistingSheet(client({ write }), URL)).resolves.toEqual({
      kind: "ready",
      sheet: { spreadsheetId: ID, spreadsheetUrl: URL },
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("招待リンクも受け付ける", async () => {
    const opened = await openExistingSheet(client(), `shoppinglist://join?sheet=${ID}`);
    expect(opened).toMatchObject({ kind: "ready", sheet: { spreadsheetId: ID } });
  });

  it("読めるが書けないシートは閲覧だけとして止める", async () => {
    await expect(openExistingSheet(client({ write: forbidden }), URL)).rejects.toBeInstanceOf(ReadOnlySheetError);
  });

  it("書き込みのほかの失敗はそのまま伝える", async () => {
    const write = async () => {
      throw new RemoteError("offline", "つながらない");
    };
    await expect(openExistingSheet(client({ write }), URL)).rejects.toMatchObject({ kind: "offline" });
  });

  it("アプリの形でないシートは、書く前に確認に回す", async () => {
    const write = vi.fn(async () => ({}));
    const batchUpdate = vi.fn(async () => ({}));
    const opened = await openExistingSheet(client({ titles: ["家計簿"], write, batchUpdate }), URL);
    expect(opened).toMatchObject({ kind: "needsInit", spreadsheetId: ID });
    expect(write).not.toHaveBeenCalled();
    expect(batchUpdate).not.toHaveBeenCalled();
  });
});

describe("initSheet", () => {
  it("足りないシートを足す", async () => {
    const batchUpdate = vi.fn(async () => ({}));
    await expect(initSheet(client({ titles: ["家計簿"], batchUpdate }), ID)).resolves.toEqual({ spreadsheetId: ID, spreadsheetUrl: URL });
    expect(batchUpdate).toHaveBeenCalledTimes(1);
  });

  it("閲覧だけの権限なら止める", async () => {
    await expect(initSheet(client({ titles: ["家計簿"], batchUpdate: forbidden }), ID)).rejects.toBeInstanceOf(ReadOnlySheetError);
  });
});

describe("createSheet", () => {
  const offline = async () => {
    throw new RemoteError("offline", "つながらない");
  };

  it("初期化に失敗したら ID を残し、次はそのシートへ続きを行う", async () => {
    const drafts = memoryDrafts();
    const create = vi.fn(async () => ({ spreadsheetId: ID, sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }] }));
    await expect(createSheet(client({ titles: ["Sheet1"], create, batchUpdate: offline }), drafts)).rejects.toMatchObject({ kind: "offline" });
    expect(drafts.load()).toContain(ID);

    const batchUpdate = vi.fn(async () => ({}));
    const sheet = await createSheet(client({ titles: ["Sheet1"], create, batchUpdate }), drafts);

    expect(sheet.spreadsheetId).toBe(ID);
    expect(create).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(drafts.load()).toBeNull();
  });

  it("作りかけのシートが消えていたら、新しく作る", async () => {
    const drafts = memoryDrafts(JSON.stringify({ spreadsheetId: "gone", spreadsheetUrl: "", defaultSheetId: 0 }));
    const create = vi.fn(async () => ({ spreadsheetId: ID, sheets: [] }));
    const base = client({ titles: ["Sheet1"], create });
    const get = vi.fn(base.get.bind(base));
    get.mockRejectedValueOnce(new RemoteError("notFound", "404"));
    const sheet = await createSheet({ ...base, get, batchGet: base.batchGet, batchUpdate: base.batchUpdate, create: base.create } as unknown as SheetsClient, drafts);
    expect(sheet.spreadsheetId).toBe(ID);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("通信の失敗では作り直さない", async () => {
    const drafts = memoryDrafts(JSON.stringify({ spreadsheetId: ID, spreadsheetUrl: URL, defaultSheetId: 0 }));
    const create = vi.fn(async () => ({ spreadsheetId: "other" }));
    await expect(createSheet(client({ titles: ["Sheet1"], create, batchUpdate: offline }), drafts)).rejects.toMatchObject({ kind: "offline" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("sheetErrorMessage", () => {
  it("閲覧だけの権限を原因として伝える", () => {
    expect(sheetErrorMessage(new ReadOnlySheetError(), URL)).toContain("閲覧だけ");
  });

  it("URL でないものを貼ったときを伝える", () => {
    expect(sheetErrorMessage(new RemoteError("invalid", "x"), "こんにちは")).toContain("URL ではありません");
  });

  it("止めた原因をそのまま伝える", () => {
    expect(sheetErrorMessage(new RemoteError("schema", "同じ名前で列の違うシートがある: Items"), URL)).toContain("Items");
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
