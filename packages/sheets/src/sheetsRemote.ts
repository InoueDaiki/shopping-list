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
  type Iso,
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
import { decodePresence, markerChanged, writeMarker, type Peek, type PresenceRow } from "./presence.ts";
import {
  HISTORY_SHEET,
  ITEM_CHECK_COLUMNS,
  META_RANGE,
  PRESENCE_SHEET,
  TABLE_SHEETS,
  columnIndex,
  dataRange,
} from "./schema.ts";
import {
  assertSchemaVersion,
  surveySpreadsheet,
  upgradeSpreadsheet,
  type SheetIds,
} from "./setup.ts";
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

// シートがそろい、見出しと版が合うことを確かめて、シートの番号を返す。前の版なら上げる
async function inspect(client: SheetsClient, spreadsheetId: string): Promise<SheetIds> {
  const survey = await surveySpreadsheet(client, spreadsheetId);
  if (survey.missing.length > 0) {
    throw new RemoteError("schema", `シートが足りない: ${survey.missing.join("、")}`);
  }
  return (await upgradeSpreadsheet(client, spreadsheetId, survey)).sheetIds as SheetIds;
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
  // 端末ごとの乱数の ID。変更の印と在室の行に書く。名前やメールは書かない
  deviceId?: string;
  now?: () => number;
  // 全部の読み取りのたびに、一緒に読んだ在室を渡す
  onPresence?: (presence: PresenceRow[]) => void;
}

export interface PresenceWrite {
  listId: Id;
  until: Iso;
}

export class SheetsRemote implements RemoteStore {
  readonly #client: SheetsClient;
  readonly #spreadsheetId: string;
  readonly #deviceId: string;
  readonly #now: () => number;
  readonly #onPresence: ((presence: PresenceRow[]) => void) | undefined;
  #sheetIds: Promise<SheetIds> | null = null;
  // 前回の全部の読み取りで見た印(undefined はまだ読んでいない)と、自分が最後に書いた印
  #seenMarker: string | null | undefined = undefined;
  #ownMarker: string | null = null;
  // 自分の在室の行。null は行が無い、undefined は分からない(足した直後も、読むまで分からない)
  #presenceRow: number | null | undefined = undefined;

  constructor(options: SheetsRemoteOptions) {
    this.#client = options.client;
    this.#spreadsheetId = options.spreadsheetId;
    this.#deviceId = options.deviceId ?? "unknown";
    this.#now = options.now ?? Date.now;
    this.#onPresence = options.onPresence;
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
    // 変更の印も同じ batchUpdate で書く。要求の回数は増えない
    const marker = writeMarker(new Date(this.#now()).toISOString(), this.#deviceId);
    requests.push({
      updateCells: {
        start: { sheetId: ids.Meta, rowIndex: 1, columnIndex: 1 },
        rows: [rowData([marker])],
        fields: "userEnteredValue",
      },
    });
    await this.#client.batchUpdate(this.#spreadsheetId, requests);
    this.#ownMarker = marker;
  }

  // 印と在室だけを読む。読み取り1回
  async peek(): Promise<Peek> {
    await this.#ids();
    const [meta, presence] = await this.#client.batchGet(this.#spreadsheetId, [
      META_RANGE,
      dataRange(PRESENCE_SHEET),
    ]);
    assertSchemaVersion(meta);
    const marker = markerOf(meta);
    return {
      changed: markerChanged(marker, { seen: this.#seenMarker, own: this.#ownMarker }),
      presence: this.#readPresence(presence),
    };
  }

  // 自分の在室の行を上書きする。書き込み1回。行が分からなければ、先に在室を読む(読み取り1回)
  async writePresence({ listId, until }: PresenceWrite): Promise<void> {
    const ids = await this.#ids();
    if (this.#presenceRow === undefined) {
      const [presence] = await this.#client.batchGet(this.#spreadsheetId, [
        dataRange(PRESENCE_SHEET),
      ]);
      this.#readPresence(presence);
    }
    const sheetId = ids.Presence;
    const row = rowData([this.#deviceId, listId, until, new Date(this.#now()).toISOString()]);
    const request =
      typeof this.#presenceRow === "number"
        ? {
            updateCells: {
              start: { sheetId, rowIndex: this.#presenceRow - 1, columnIndex: 0 },
              rows: [row],
              fields: "userEnteredValue",
            },
          }
        : { appendCells: { sheetId, rows: [row], fields: "userEnteredValue" } };
    await this.#client.batchUpdate(this.#spreadsheetId, [request]);
    // 足した行の位置は、ほかの端末も足していると分からない。次に読むまで分からないことにする
    if (typeof this.#presenceRow !== "number") this.#presenceRow = undefined;
  }

  // 次の writePresence が先に読む必要があるか。回数を数えるのに使う
  presenceKnown(): boolean {
    return this.#presenceRow !== undefined;
  }

  #readPresence(range: ValueRange | undefined): PresenceRow[] {
    const rows = decodePresence(range?.values ?? [], FIRST_DATA_ROW);
    // 行が重なったら(足す書き込みの応答を失ったなど)、最初の行を使い続ける
    this.#presenceRow = rows.find((row) => row.deviceId === this.#deviceId)?.rowNumber ?? null;
    return rows;
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
    const meta = ranges[TABLES.length];
    assertSchemaVersion(meta);
    // 中身と同じ1回の読み取りで読んだ印なので、この印までの変更は手元にある
    this.#seenMarker = markerOf(meta);
    this.#onPresence?.(this.#readPresence(ranges[TABLES.length + 2]));

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
      META_RANGE,
      dataRange(HISTORY_SHEET, fromRow),
      // 在室も一緒に読む。要求の回数は増えない
      dataRange(PRESENCE_SHEET),
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

function markerOf(meta: ValueRange | undefined): string | null {
  const cell = meta?.values?.[0]?.[1];
  return typeof cell === "string" && cell !== "" ? cell : null;
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
