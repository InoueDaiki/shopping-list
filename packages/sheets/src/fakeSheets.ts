// テスト用の偽の Sheets API。index.ts からは出さない。
// 使う要求だけを、セルの二次元配列の上で再現する。

import type { Cell, FetchInit, FetchLike, FetchResponse } from "./client.ts";

interface FakeSheet {
  sheetId: number;
  title: string;
  grid: Cell[][];
}

interface CellData {
  userEnteredValue?: {
    stringValue?: string;
    numberValue?: number;
    boolValue?: boolean;
  };
}

function cellValue(cell: CellData): Cell {
  const value = cell.userEnteredValue;
  return value?.stringValue ?? value?.numberValue ?? value?.boolValue ?? null;
}

function rowsOf(rows: { values: CellData[] }[]): Cell[][] {
  return rows.map((row) => row.values.map(cellValue));
}

function respond(status: number, body: unknown): FetchResponse {
  return {
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

function parseRange(range: string) {
  const match = /^(\w+)!A(\d+)(?::([A-Z]+)(\d+)?)?$/.exec(range);
  if (match === null) throw new Error(`解釈できない範囲: ${range}`);
  const [, title, from, lastColumn] = match;
  return {
    title: title as string,
    from: Number(from),
    columns: lastColumn === undefined ? 1 : lastColumn.charCodeAt(0) - 64,
    single: lastColumn === undefined,
  };
}

export class FakeSheets {
  readonly sheets: FakeSheet[] = [];
  readonly calls: { method: string; url: string }[] = [];
  // 次の要求で返す状態。テストが積む
  readonly failures: FetchResponse[] = [];
  // true を返す要求が混ざると、batchUpdate の全体を 400 で拒否する。何も反映しない
  rejects: ((request: Record<string, unknown>) => boolean) | null = null;
  spreadsheetId = "fakeSpreadsheetId0123456789";

  sheet(title: string): FakeSheet {
    const found = this.sheets.find((candidate) => candidate.title === title);
    if (found === undefined) throw new Error(`シートが無い: ${title}`);
    return found;
  }

  count(fragment: string): number {
    return this.calls.filter((call) => call.url.includes(fragment)).length;
  }

  readonly fetch: FetchLike = async (url, init) => {
    this.calls.push({ method: init.method, url });
    const failure = this.failures.shift();
    if (failure !== undefined) return failure;
    return this.#route(url, init);
  };

  #route(url: string, init: FetchInit): FetchResponse {
    if (init.method === "POST" && url.endsWith("/spreadsheets")) {
      this.sheets.push({ sheetId: 0, title: "Sheet1", grid: [] });
      return respond(200, {
        spreadsheetId: this.spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit`,
        sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }],
      });
    }
    if (url.includes(":batchUpdate")) {
      const { requests } = JSON.parse(init.body ?? "{}") as {
        requests: Record<string, never>[];
      };
      if (requests.some((request) => this.rejects?.(request))) {
        return respond(400, { error: { message: "入力規則の違反" } });
      }
      for (const request of requests) this.#apply(request);
      return respond(200, { replies: [] });
    }
    if (url.includes("values:batchGet")) return this.#batchGet(url);
    return respond(200, {
      spreadsheetId: this.spreadsheetId,
      sheets: this.sheets.map(({ sheetId, title }) => ({
        properties: { sheetId, title },
      })),
    });
  }

  #batchGet(url: string): FetchResponse {
    const query = url.slice(url.indexOf("?") + 1).split("&");
    const ranges = query
      .filter((part) => part.startsWith("ranges="))
      .map((part) => decodeURIComponent(part.slice("ranges=".length)));
    const valueRanges = ranges.map((range) => {
      const { title, from, columns } = parseRange(range);
      const rows = this.sheet(title)
        .grid.slice(from - 1)
        .map((row) => row.slice(0, columns));
      // 本物と同じく、末尾の空のセルと空の行を返さない
      const values = rows.map((row) => {
        const trimmed = [...row];
        while (trimmed.length > 0 && (trimmed.at(-1) ?? null) === null) trimmed.pop();
        return trimmed;
      });
      while (values.length > 0 && values.at(-1)?.length === 0) values.pop();
      return { range, ...(values.length > 0 ? { values } : {}) };
    });
    return respond(200, { valueRanges });
  }

  #byId(sheetId: number): FakeSheet {
    const found = this.sheets.find((candidate) => candidate.sheetId === sheetId);
    if (found === undefined) throw new Error(`シートが無い: ${sheetId}`);
    return found;
  }

  #apply(request: Record<string, never>): void {
    const [name] = Object.keys(request);
    const body = request[name as string] as unknown as Record<string, never>;
    switch (name) {
      case "addSheet": {
        const { sheetId, title } = body.properties as unknown as FakeSheet;
        this.sheets.push({ sheetId, title, grid: [] });
        break;
      }
      case "deleteSheet": {
        const index = this.sheets.findIndex((s) => s.sheetId === Number(body.sheetId));
        this.sheets.splice(index, 1);
        break;
      }
      case "appendCells": {
        const { grid } = this.#byId(body.sheetId);
        grid.push(...rowsOf(body.rows as unknown as { values: CellData[] }[]));
        break;
      }
      case "updateCells": {
        const start = body.start as unknown as {
          sheetId: number;
          rowIndex: number;
          columnIndex: number;
        };
        const { grid } = this.#byId(start.sheetId);
        const rows = rowsOf(body.rows as unknown as { values: CellData[] }[]);
        // 渡したセルだけが変わり、右のセルは残る
        rows.forEach((row, i) => {
          const target = (grid[start.rowIndex + i] ??= []);
          while (target.length < start.columnIndex) target.push(null);
          target.splice(start.columnIndex, row.length, ...row);
        });
        break;
      }
      default:
        // 書式、入力規則、保護は値に関わらない
        break;
    }
  }
}
