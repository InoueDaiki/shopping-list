import {
  MemoryLocalStore,
  RemoteError,
  SyncEngine,
  type HistoryEntry,
  type Item,
} from "@shopping-list/core";
import { beforeEach, describe, expect, it } from "vitest";

import { SheetsClient, type FetchResponse } from "./client.ts";
import { encodeRow } from "./codec.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { FakeSheets } from "./fakeSheets.ts";
import {
  beginSpreadsheet,
  createSpreadsheet,
  ensureSpreadsheet,
  surveySpreadsheet,
} from "./setup.ts";
import { SheetsRemote, openSpreadsheet } from "./sheetsRemote.ts";

const T = (minute: number) => `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`;

function item(id: string, updatedAt: string, memo = ""): Item {
  return {
    id,
    listId: "list1",
    name: "=とうふ",
    categoryId: "cat_seafood",
    categorySource: "user",
    memo,
    checked: false,
    checkedAt: null,
    checkedStoreId: null,
    checkedUpdatedAt: updatedAt,
    updatedAt,
  };
}

function history(id: string, seq = 1): HistoryEntry {
  return {
    id,
    listId: "list1",
    name: "牛乳",
    categoryId: null,
    categorySource: null,
    storeId: null,
    tripId: null,
    checkedAt: T(0),
    checkedSeq: seq,
  };
}

const putItem = (row: Item) => ({ action: "put", table: "items", row }) as const;
const putHistory = (row: HistoryEntry) => ({ action: "put", table: "history", row }) as const;

function status(code: number): FetchResponse {
  return { status: code, headers: { get: () => null }, text: async () => "{}" };
}

describe("SheetsRemote", () => {
  let server: FakeSheets;
  let client: SheetsClient;
  let spreadsheetId: string;

  const device = () => {
    const local = new MemoryLocalStore();
    const remote = new SheetsRemote({ client, spreadsheetId });
    return { local, remote, engine: new SyncEngine({ local, remote }) };
  };
  const ids = (title: string) => server.sheet(title).grid.slice(1).map((row) => row[0]);

  beforeEach(async () => {
    server = new FakeSheets();
    client = new SheetsClient({
      fetch: server.fetch,
      getAccessToken: async () => "test-token",
      sleep: async () => {},
    });
    ({ spreadsheetId } = await createSpreadsheet(client, "買い物リスト"));
    server.sheet("Lists").grid.push(["list1", "スーパー", 1, T(0)]);
    server.calls.length = 0;
  });

  it("作成したシートを、もう1人が URL で開ける", async () => {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0`;
    await expect(openSpreadsheet(client, url)).resolves.toEqual({ spreadsheetId });
  });

  it("違う形のシートは開けない", async () => {
    server.sheets.splice(0, 1);
    await expect(openSpreadsheet(client, spreadsheetId)).rejects.toMatchObject({
      kind: "schema",
    });
    await expect(openSpreadsheet(client, "買い物")).rejects.toMatchObject({ kind: "invalid" });
  });

  it("見出しが違うシートは開けない", async () => {
    const header = server.sheet("Items").grid[0];
    if (header !== undefined) header[2] = "title";
    await expect(openSpreadsheet(client, spreadsheetId)).rejects.toMatchObject({
      kind: "schema",
    });
  });

  describe("列単位の後勝ち", () => {
    const cell = (column: number) => server.sheet("Items").grid[1]?.[column];

    it("チェックとメモを別のセルに書き、2端末で両方が残る", async () => {
      const a = device();
      const b = device();
      await a.local.commit([putItem(item("i1", T(1)))]);
      await a.engine.sync();
      await b.engine.sync();
      const base = item("i1", T(1));

      await a.local.commit([
        putItem({ ...base, checked: true, checkedAt: T(2), checkedStoreId: null, checkedUpdatedAt: T(2) }),
      ]);
      await b.local.commit([putItem({ ...base, memo: "2本", updatedAt: T(3) })]);
      await b.engine.sync();
      await a.engine.sync();
      await b.engine.sync();

      expect(cell(5)).toBe("2本");
      expect(cell(6)).toBe(true);
      expect(cell(9)).toBe(T(2));
      expect(cell(10)).toBe(T(3));
      for (const { local } of [a, b]) {
        expect(local.rows.items.get("i1")).toMatchObject({ checked: true, memo: "2本" });
      }
    });

    it("チェックだけの書き込みは、ほかのセルに触らない", async () => {
      const a = device();
      await a.local.commit([putItem(item("i1", T(1)))]);
      await a.engine.sync();
      const row = server.sheet("Items").grid[1] as (string | null)[];
      row[5] = "シートのメモ";
      row[10] = T(1);

      await a.local.commit([
        putItem({ ...item("i1", T(1)), checked: true, checkedAt: T(2), checkedUpdatedAt: T(2) }),
      ]);
      await a.engine.sync();

      expect(cell(5)).toBe("シートのメモ");
      expect(cell(6)).toBe(true);
    });
  });

  describe("既存のシート", () => {
    const blank = () => {
      server.sheets.length = 0;
      server.sheets.push({ sheetId: 7, title: "家計簿", grid: [["日付", "金額"], ["1/1", 100]] });
    };

    it("足りないシートを調べても何も書かない", async () => {
      blank();
      const { missing } = await surveySpreadsheet(client, spreadsheetId);
      expect(missing).toContain("Items");
      expect(server.count(":batchUpdate")).toBe(0);
    });

    it("既存のシートに触らず、足りないシートを足して使えるようにする", async () => {
      blank();
      await ensureSpreadsheet(client, spreadsheetId);

      expect(server.sheet("家計簿").grid).toEqual([["日付", "金額"], ["1/1", 100]]);
      await expect(openSpreadsheet(client, spreadsheetId)).resolves.toEqual({ spreadsheetId });
      expect(server.sheet("Categories").grid.length).toBeGreaterThan(1);
    });

    it("番号が重なるシートがあっても足せる", async () => {
      blank();
      server.sheet("家計簿").sheetId = 104;
      await ensureSpreadsheet(client, spreadsheetId);
      const numbers = server.sheets.map((sheet) => sheet.sheetId);
      expect(new Set(numbers).size).toBe(numbers.length);
    });

    it("一部のシートだけ足りなければ、それだけを足し、中身を変えない", async () => {
      const before = [...server.sheet("Lists").grid];
      server.sheets.splice(server.sheets.indexOf(server.sheet("History")), 1);
      await ensureSpreadsheet(client, spreadsheetId);
      expect(server.sheet("Lists").grid).toEqual(before);
      expect(server.sheet("History").grid[0]?.[0]).toBe("id");
    });

    it("同じ名前で列の違うシートがあれば、原因を出して止める", async () => {
      blank();
      server.sheets.push({ sheetId: 8, title: "Items", grid: [["品名", "数"]] });
      await expect(ensureSpreadsheet(client, spreadsheetId)).rejects.toMatchObject({
        kind: "schema",
        message: expect.stringContaining("Items"),
      });
      expect(server.count(":batchUpdate")).toBe(0);
    });

    it("途中で失敗したシートは、続きを行えば1つのまま仕上がる", async () => {
      server.sheets.length = 0;
      const created = await beginSpreadsheet(client, "買い物リスト");
      server.failures.push(status(400));
      await expect(
        ensureSpreadsheet(client, created.spreadsheetId, { defaultSheetId: created.defaultSheetId }),
      ).rejects.toBeDefined();

      server.calls.length = 0;
      await ensureSpreadsheet(client, created.spreadsheetId, { defaultSheetId: created.defaultSheetId });

      expect(server.calls.some((call) => call.url.endsWith("/spreadsheets"))).toBe(false);
      expect(server.sheets.some((sheet) => sheet.title === "Sheet1")).toBe(false);
      await expect(openSpreadsheet(client, created.spreadsheetId)).resolves.toBeDefined();
    });
  });

  it("新しいスキーマの版のシートでは同期しない", async () => {
    server.sheet("Meta").grid[1] = [SCHEMA_VERSION + 1];
    const { engine } = device();
    const result = await engine.sync();
    expect(result.status).toBe("failed");
    expect(result.error?.kind).toBe("schema");
  });

  it("初期のカテゴリを取り込み、2端末で品目を受け渡す", async () => {
    const a = device();
    const b = device();
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    expect(b.local.rows.items.get("i1")).toEqual(item("i1", T(1)));
    expect(b.local.rows.categories.get("cat_seafood")?.name).toBe("鮮魚");
    expect(b.local.rows.lists.size).toBe(1);
  });

  it("書き込みは batchUpdate の1回で、値は文字列のまま送る", async () => {
    const a = device();
    await a.engine.sync();
    server.calls.length = 0;
    await a.local.commit([putItem(item("i1", T(1))), putItem(item("i2", T(1)))]);
    await a.engine.sync();

    expect(server.count(":batchUpdate")).toBe(1);
    expect(server.count("values:batchGet")).toBe(2);
    expect(server.sheet("Items").grid[1]?.[2]).toBe("=とうふ");
  });

  it("ID で行を探して更新し、消しても行を詰めない", async () => {
    const a = device();
    await a.local.commit([
      putItem(item("i1", T(1))),
      putItem(item("i2", T(1))),
      putItem(item("i3", T(1))),
    ]);
    await a.engine.sync();

    // 手で並べ替えられても正しい行を直す
    const grid = server.sheet("Items").grid;
    [grid[1], grid[3]] = [grid[3] as (typeof grid)[1], grid[1] as (typeof grid)[1]];

    await a.local.commit([
      putItem(item("i3", T(2), "更新")),
      { action: "delete", table: "items", id: "i2", at: T(2) },
      putItem(item("i4", T(2))),
    ]);
    await a.engine.sync();

    expect(ids("Items")).toEqual(["i3", "i2", "i1", "i4"]);
    expect(server.sheet("Items").grid[1]?.[5]).toBe("更新");
    expect(server.sheet("Items").grid[2]?.[11]).toBe(T(2));
    // 行の中身は残す。deleted_at のセルだけを書く
    expect(server.sheet("Items").grid[2]?.[2]).toBe("=とうふ");
    expect([...a.local.rows.items.keys()].sort()).toEqual(["i1", "i3", "i4"]);
  });

  it("墓石の行は pull に出ず、もう1台からも消える", async () => {
    const a = device();
    const b = device();
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await a.local.commit([{ action: "delete", table: "items", id: "i1", at: T(2) }]);
    await a.engine.sync();
    await b.engine.sync();

    expect(b.local.rows.items.has("i1")).toBe(false);
    expect(server.count("deleteDimension")).toBe(0);
  });

  it("オフラインの古い編集は墓石に負け、新しい編集は deleted_at を空にして生き返る", async () => {
    const a = device();
    const b = device();
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();

    await a.local.commit([{ action: "delete", table: "items", id: "i1", at: T(3) }]);
    await a.engine.sync();
    await b.local.commit([putItem(item("i1", T(2), "古い"))]);
    await b.engine.sync();
    expect(b.local.rows.items.has("i1")).toBe(false);
    expect(server.sheet("Items").grid[1]?.[11]).toBe(T(3));

    await b.local.commit([putItem(item("i1", T(4), "新しい"))]);
    await b.engine.sync();
    await a.engine.sync();
    expect(a.local.rows.items.get("i1")?.memo).toBe("新しい");
    expect(server.sheet("Items").grid[1]?.[11]).toBeNull();
  });

  it("墓石より updated_at が新しい行は生きている", async () => {
    const row = encodeRow("items", item("i1", T(5)));
    row[11] = T(3);
    server.sheet("Items").grid.push(row);
    const a = device();
    await a.engine.sync();
    expect(a.local.rows.items.has("i1")).toBe(true);
  });

  it("重なった行の新しいほうが墓石なら取り込まない", async () => {
    const tombstone = encodeRow("items", item("i1", T(1)));
    tombstone[11] = T(4);
    server.sheet("Items").grid.push(encodeRow("items", item("i1", T(2))), tombstone);
    const a = device();
    await a.engine.sync();
    expect(a.local.rows.items.has("i1")).toBe(false);
  });

  it("マスタの競合も updated_at の後勝ちで決まる", async () => {
    const list = (name: string, at: string) => ({
      action: "put" as const,
      table: "lists" as const,
      row: { id: "list1", name, sort: 1, updatedAt: at },
    });
    const a = device();
    const b = device();
    await a.local.commit([list("新しい", T(5))]);
    await b.local.commit([list("古い", T(3))]);
    await a.engine.sync();
    await b.engine.sync();

    expect(server.sheet("Lists").grid[1]?.[1]).toBe("新しい");
    expect(b.local.rows.lists.get("list1")?.name).toBe("新しい");
  });

  it("400 で拒否されたら分けて送り、原因の1件を隔離する", async () => {
    const a = device();
    await a.engine.sync();
    await a.local.commit([
      putItem(item("i1", T(1))),
      putItem(item("i2", T(1), "拒否")),
      putItem(item("i3", T(1))),
    ]);
    server.rejects = (request) => JSON.stringify(request).includes("拒否");

    const result = await a.engine.sync();

    expect(result.status).toBe("ok");
    expect(ids("Items").sort()).toEqual(["i1", "i3"]);
    expect(result.issues).toMatchObject([{ table: "items", id: "i2" }]);
    expect(result.pending).toBe(1);
    expect(a.local.rows.items.has("i2")).toBe(true);
  });

  it("後勝ちで古い変更は書かれず、ローカルが新しい値になる", async () => {
    const a = device();
    const b = device();
    await a.local.commit([putItem(item("i1", T(1)))]);
    await a.engine.sync();
    await b.engine.sync();
    await a.local.commit([putItem(item("i1", T(5), "新しい"))]);
    await b.local.commit([putItem(item("i1", T(3), "古い"))]);
    await a.engine.sync();
    await b.engine.sync();

    expect(server.sheet("Items").grid[1]?.[5]).toBe("新しい");
    expect(b.local.rows.items.get("i1")?.memo).toBe("新しい");
  });

  it("同じ ID の行が重なったら、読むときも更新するときも新しい行を使い、行は消さない", async () => {
    const a = device();
    server.sheet("Items").grid.push(
      encodeRow("items", item("i1", T(1), "古い")),
      encodeRow("items", item("i1", T(2), "新しい")),
    );
    await a.engine.sync();
    expect(a.local.rows.items.get("i1")?.memo).toBe("新しい");

    await a.local.commit([putItem(item("i1", T(3), "最新"))]);
    await a.engine.sync();
    expect(ids("Items")).toEqual(["i1", "i1"]);
    expect(server.sheet("Items").grid[2]?.[5]).toBe("最新");
    await a.engine.sync();
    expect(a.local.rows.items.get("i1")?.memo).toBe("最新");
  });

  it("不正な行は報告し、正しい行は取り込む", async () => {
    server.sheet("Items").grid.push(
      encodeRow("items", item("i1", T(1))),
      ["i2", "list1", "", null, null, null, "はい", null, null, T(1), "昨日", null],
    );
    const a = device();
    const result = await a.engine.sync();

    expect(result.status).toBe("ok");
    expect(a.local.rows.items.has("i1")).toBe(true);
    expect(result.issues).toMatchObject([{ table: "items", row: 3, id: "i2" }]);
    expect(result.issues[0]?.problems.map((p) => p.column)).toEqual([
      "name",
      "checked",
      "updated_at",
    ]);
  });

  describe("History の差分読み", () => {
    const historyRange = () =>
      server.calls
        .filter((call) => call.url.includes("values:batchGet"))
        .map((call) => decodeURIComponent(call.url))
        .filter((url) => url.includes("History!A"))
        .at(-1)
        ?.match(/History![A-Z0-9:]+/)?.[0];

    it("前回の続きだけを読み、最後の行を重ねて確かめる", async () => {
      const a = device();
      await a.local.commit([putHistory(history("h1")), putHistory(history("h2"))]);
      await a.engine.sync();
      expect(await a.local.historyCursor()).toEqual({ position: 4, lastId: "h2" });

      await a.local.commit([putHistory(history("h3"))]);
      await a.engine.sync();
      expect(historyRange()).toBe("History!A3:I");
      expect(await a.local.historyCursor()).toEqual({ position: 5, lastId: "h3" });
      expect(a.local.rows.history.size).toBe(3);
    });

    it("History を書くだけなら ID の列を読まない", async () => {
      const a = device();
      await a.engine.sync();
      server.calls.length = 0;
      await a.local.commit([putHistory(history("h1"))]);
      await a.engine.sync();
      expect(server.count("values:batchGet")).toBe(1);
    });

    it("手で行が消され、位置が信じられないときは頭から読み直す", async () => {
      const a = device();
      await a.local.commit([putHistory(history("h1")), putHistory(history("h2"))]);
      await a.engine.sync();

      server.sheet("History").grid.splice(1, 1);
      server.sheet("History").grid.push(encodeRow("history", history("h3")));
      await a.engine.sync();

      expect(await a.local.historyCursor()).toEqual({ position: 4, lastId: "h3" });
      expect(a.local.rows.history.has("h3")).toBe(true);
    });

    it("不正な行は直されるまで報告し続け、その先の行も取り込む", async () => {
      const a = device();
      const grid = server.sheet("History").grid;
      grid.push(
        encodeRow("history", history("h1")),
        ["h2", "list1", "牛乳", null, null, null, null, "壊れた日時", 1],
        encodeRow("history", history("h3")),
      );

      const first = await a.engine.sync();
      expect(first.issues).toMatchObject([{ table: "history", row: 3, id: "h2" }]);
      expect(a.local.rows.history.has("h3")).toBe(true);
      expect(await a.local.historyCursor()).toEqual({ position: 3, lastId: "h1" });

      expect((await a.engine.sync()).issues).toHaveLength(1);

      grid[2] = encodeRow("history", history("h2"));
      const fixed = await a.engine.sync();
      expect(fixed.issues).toEqual([]);
      expect(a.local.rows.history.has("h2")).toBe(true);
      expect(await a.local.historyCursor()).toEqual({ position: 5, lastId: "h3" });
    });

    it("送り直しで History の行が重なっても、ローカルでは1件になる", async () => {
      const a = device();
      await a.engine.sync();
      const row = encodeRow("history", history("h1"));
      server.sheet("History").grid.push(row, [...row]);
      await a.engine.sync();
      expect(a.local.rows.history.size).toBe(1);
    });
  });

  describe("失敗", () => {
    it("通信の失敗では送信待ちを残し、次に送る", async () => {
      const a = device();
      await a.engine.sync();
      await a.local.commit([putItem(item("i1", T(1)))]);

      server.failures.push(status(401), status(401));
      const failed = await a.engine.sync();
      expect(failed.status).toBe("failed");
      expect(failed.error?.kind).toBe("auth");
      expect(failed.pending).toBe(1);

      const retried = await a.engine.sync();
      expect(retried.status).toBe("ok");
      expect(ids("Items")).toEqual(["i1"]);
    });

    it("5xx は再試行して成功する", async () => {
      const a = device();
      await a.engine.sync();
      await a.local.commit([putItem(item("i1", T(1)))]);
      server.failures.push(status(503));
      expect((await a.engine.sync()).status).toBe("ok");
    });

    it("書けたのに応答を失っても、次の送信で行を重ねない", async () => {
      const a = device();
      await a.engine.sync();
      await a.local.commit([putItem(item("i1", T(1)))]);

      const remote = new SheetsRemote({ client, spreadsheetId });
      const engine = new SyncEngine({
        local: a.local,
        remote: {
          locate: (tables) => remote.locate(tables),
          pull: (cursor) => remote.pull(cursor),
          write: async (writes) => {
            await remote.write(writes);
            throw new RemoteError("offline", "応答なし");
          },
        },
      });
      await engine.sync();
      await a.engine.sync();

      expect(ids("Items")).toEqual(["i1"]);
      expect(await a.local.pendingCount()).toBe(0);
    });
  });
});
