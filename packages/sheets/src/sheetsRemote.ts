// RemoteStore のスプレッドシートの実装。
// 書き込みは batchUpdate の1回にまとめる。全部反映されるか何も反映されないかになり、回数も1回で済む。
// 行は消さない。行の位置がずれないので、locate と write の間に別の端末が書いても別の行を上書きしない。

import {
  RemoteError,
  compareIso,
  isTombstoned,
  newestVersion,
  rowId,
  rowVersion,
  type HistoryCursor,
  type HistoryEntry,
  type Id,
  type MutableTable,
  type RemoteIndex,
  type RemoteRowRef,
  type RemoteSnapshot,
  type RemoteStore,
  type RemoteWrite,
  type RowIssue,
  type RowOf,
  type TableRows,
  type TableSnapshot,
} from "@shopping-list/core";

import { rowData } from "./cells.ts";
import type { Cell, SheetsClient, SheetsRequest, ValueRange } from "./client.ts";
import { decodeRow, encodeChange, isId, isIso } from "./codec.ts";
import {
  HISTORY_SHEET,
  ITEM_CHECK_COLUMNS,
  META_SHEET,
  TABLE_SHEETS,
  columnIndex,
  dataRange,
} from "./schema.ts";
import { assertSchemaVersion, surveySpreadsheet, type SheetIds } from "./setup.ts";
import { parseSpreadsheetId } from "./spreadsheetId.ts";

const FIRST_DATA_ROW = 2;
const VERSION_COLUMNS: Record<MutableTable, string> = {
  lists: "updated_at",
  categories: "updated_at",
  stores: "updated_at",
  items: "updated_at",
  storeOrders: "edited_at",
};
const DELETED_AT = "deleted_at";
const TABLES: readonly MutableTable[] = [
  "lists",
  "categories",
  "stores",
  "items",
  "storeOrders",
];

// Items の更新で書く列の範囲([始まり, 終わり) の組)。part が無ければ行全体
function updateSpans(write: RemoteWrite, length: number): [number, number][] {
  if (write.kind !== "update" || write.part === undefined) return [[0, length]];
  const def = TABLE_SHEETS.items;
  const from = columnIndex(def, ITEM_CHECK_COLUMNS[0]);
  const to = from + ITEM_CHECK_COLUMNS.length;
  return write.part === "check"
    ? [[from, to]]
    : [
        [0, from],
        [to, length],
      ];
}

// シートがそろい、見出しと版が合うことを確かめて、シートの番号を返す
async function inspect(client: SheetsClient, spreadsheetId: string): Promise<SheetIds> {
  const { missing, sheetIds } = await surveySpreadsheet(client, spreadsheetId);
  if (missing.length > 0) {
    throw new RemoteError("schema", `シートが足りない: ${missing.join("、")}`);
  }
  return sheetIds as SheetIds;
}

// 2人目の初期化。貼られた URL か ID を検査し、スプレッドシートの ID を返す。
// 形が違えば RemoteError(invalid、notFound、forbidden、schema)を投げる
export async function openSpreadsheet(
  client: SheetsClient,
  urlOrId: string,
): Promise<{ spreadsheetId: string }> {
  const spreadsheetId = parseSpreadsheetId(urlOrId);
  if (spreadsheetId === null) {
    throw new RemoteError("invalid", "スプレッドシートの URL ではない");
  }
  await inspect(client, spreadsheetId);
  return { spreadsheetId };
}

interface ReadRow<T extends MutableTable> {
  row: TableRows[T];
  deletedAt: string | null;
}

// 同じ ID の行が重なっていたら、新しいほうを1行だけ取る。それが墓石なら返さない
function liveRows<T extends MutableTable>(table: T, rows: ReadRow<T>[]): TableRows[T][] {
  const latest = new Map<Id, ReadRow<T> & { version: string | null }>();
  for (const read of rows) {
    const change = { table, row: read.row } as RowOf;
    const id = rowId(change);
    const current = latest.get(id);
    const version = newestVersion(rowVersion(change), read.deletedAt);
    if (
      current === undefined ||
      (version !== null &&
        current.version !== null &&
        compareIso(version, current.version) > 0)
    ) {
      latest.set(id, { ...read, version });
    }
  }
  return [...latest.values()]
    .filter(
      ({ row, deletedAt }) =>
        !isTombstoned(rowVersion({ table, row } as RowOf), deletedAt),
    )
    .map(({ row }) => row);
}

function emptyTables(): TableSnapshot {
  return { lists: [], categories: [], stores: [], items: [], storeOrders: [] };
}

export interface SheetsRemoteOptions {
  client: SheetsClient;
  spreadsheetId: string;
}

export class SheetsRemote implements RemoteStore {
  readonly #client: SheetsClient;
  readonly #spreadsheetId: string;
  #sheetIds: Promise<SheetIds> | null = null;

  constructor(options: SheetsRemoteOptions) {
    this.#client = options.client;
    this.#spreadsheetId = options.spreadsheetId;
  }

  // 初回だけ読む。失敗したら次にやり直す
  #ids(): Promise<SheetIds> {
    this.#sheetIds ??= inspect(this.#client, this.#spreadsheetId).catch((error: unknown) => {
      this.#sheetIds = null;
      throw error;
    });
    return this.#sheetIds;
  }

  async locate(tables: MutableTable[]): Promise<RemoteIndex> {
    await this.#ids();
    const ranges = await this.#client.batchGet(
      this.#spreadsheetId,
      tables.map((table) => dataRange(TABLE_SHEETS[table])),
    );
    const index: RemoteIndex = {};
    tables.forEach((table, i) => {
      const def = TABLE_SHEETS[table];
      const versionAt = columnIndex(def, VERSION_COLUMNS[table]);
      const deletedAt = columnIndex(def, DELETED_AT);
      const checkedAt = columnIndex(def, "checked_updated_at");
      const refs: RemoteRowRef[] = [];
      (ranges[i]?.values ?? []).forEach((cells, offset) => {
        const id = cells[0];
        if (!isId(id)) return;
        // 読めない版は null にして、ローカルの正しい行で上書きできるようにする
        const isoOrNull = (cell: Cell | undefined) => (isIso(cell) ? cell : null);
        const version = isoOrNull(cells[versionAt]);
        const deleted = isoOrNull(cells[deletedAt]);
        const ref: RemoteRowRef = {
          id,
          rowNumber: FIRST_DATA_ROW + offset,
          version: newestVersion(version, deleted),
        };
        if (table === "items") {
          const check = isoOrNull(cells[checkedAt]);
          ref.version = newestVersion(ref.version, check);
          ref.parts = {
            body: newestVersion(version, deleted),
            check: newestVersion(check, deleted),
          };
        }
        refs.push(ref);
      });
      index[table] = refs;
    });
    return index;
  }

  async write(writes: RemoteWrite[]): Promise<void> {
    const ids = await this.#ids();
    const requests: SheetsRequest[] = [];
    // 続けて同じシートに足す行は、1つの appendCells にまとめる
    let appendSheetId: number | null = null;
    let appendRows: unknown[] = [];

    for (const write of writes) {
      const def = TABLE_SHEETS[write.table];
      const sheetId = ids[def.name];
      if (write.kind === "tombstone") {
        appendSheetId = null;
        requests.push({
          updateCells: {
            start: {
              sheetId,
              rowIndex: write.rowNumber - 1,
              columnIndex: columnIndex(def, DELETED_AT),
            },
            rows: [rowData([write.at])],
            fields: "userEnteredValue",
          },
        });
        continue;
      }
      const cells = encodeChange(write);
      const row = rowData(cells);
      if (write.kind === "update") {
        appendSheetId = null;
        for (const [from, to] of updateSpans(write, cells.length)) {
          requests.push({
            updateCells: {
              start: { sheetId, rowIndex: write.rowNumber - 1, columnIndex: from },
              rows: [rowData(cells.slice(from, to))],
              fields: "userEnteredValue",
            },
          });
        }
      } else if (appendSheetId === sheetId) {
        appendRows.push(row);
      } else {
        appendSheetId = sheetId;
        appendRows = [row];
        requests.push({
          appendCells: { sheetId, rows: appendRows, fields: "userEnteredValue" },
        });
      }
    }
    await this.#client.batchUpdate(this.#spreadsheetId, requests);
  }

  async pull(cursor: HistoryCursor | null): Promise<RemoteSnapshot> {
    await this.#ids();
    const start = cursor ?? { position: FIRST_DATA_ROW, lastId: null };
    // 前回の最後の行も一緒に読む。ID が合わなければ、シートが手で変えられたので読み直す
    const fromRow = start.lastId === null ? start.position : start.position - 1;

    const ranges = await this.#batchGetTail(fromRow);
    const tables = emptyTables();
    const issues: RowIssue[] = [];
    TABLES.forEach((table, i) => this.#readTable(table, ranges[i], tables, issues));
    assertSchemaVersion(ranges[TABLES.length]);

    const tail = ranges[TABLES.length + 1]?.values ?? [];
    const overlapped = start.lastId !== null && tail[0]?.[0] === start.lastId;
    if (start.lastId !== null && !overlapped) {
      const all = await this.#client.batchGet(this.#spreadsheetId, [
        dataRange(HISTORY_SHEET),
      ]);
      return {
        tables,
        ...readHistory(all[0]?.values ?? [], FIRST_DATA_ROW, null, issues),
        issues,
      };
    }
    return {
      tables,
      ...readHistory(
        overlapped ? tail.slice(1) : tail,
        start.position,
        start.lastId,
        issues,
      ),
      issues,
    };
  }

  #ranges(fromRow: number): string[] {
    return [
      ...TABLES.map((table) => dataRange(TABLE_SHEETS[table])),
      `${META_SHEET.name}!A2`,
      dataRange(HISTORY_SHEET, fromRow),
    ];
  }

  async #batchGetTail(fromRow: number): Promise<ValueRange[]> {
    try {
      return await this.#client.batchGet(this.#spreadsheetId, this.#ranges(fromRow));
    } catch (error) {
      // 手で行を減らすと、範囲がシートの外になって拒否される。頭から読み直す
      if (!(error instanceof RemoteError) || error.kind !== "invalid") throw error;
      return this.#client.batchGet(this.#spreadsheetId, this.#ranges(FIRST_DATA_ROW));
    }
  }

  #readTable<T extends MutableTable>(
    table: T,
    range: ValueRange | undefined,
    tables: TableSnapshot,
    issues: RowIssue[],
  ): void {
    const rows: ReadRow<T>[] = [];
    (range?.values ?? []).forEach((cells, offset) => {
      const decoded = decodeRow(table, cells, FIRST_DATA_ROW + offset);
      if (decoded.kind === "row") rows.push(decoded);
      if (decoded.kind === "issue") issues.push(decoded.issue);
    });
    (tables as unknown as Record<T, TableRows[T][]>)[table] = liveRows(table, rows);
  }
}

// カーソルは、不正な行の手前までしか進めない。直されたら次に取り込め、それまで報告が続く
function readHistory(
  rows: Cell[][],
  firstRow: number,
  lastId: Id | null,
  issues: RowIssue[],
): { history: HistoryEntry[]; historyCursor: HistoryCursor } {
  const history: HistoryEntry[] = [];
  const historyCursor: HistoryCursor = { position: firstRow, lastId };
  let blocked = false;
  rows.forEach((cells, offset) => {
    const rowNumber = firstRow + offset;
    const decoded = decodeRow("history", cells, rowNumber);
    if (decoded.kind === "issue") {
      blocked = true;
      issues.push(decoded.issue);
    } else if (decoded.kind === "row") {
      history.push(decoded.row);
      if (!blocked) {
        historyCursor.position = rowNumber + 1;
        historyCursor.lastId = decoded.row.id;
      }
    }
  });
  return { history, historyCursor };
}
