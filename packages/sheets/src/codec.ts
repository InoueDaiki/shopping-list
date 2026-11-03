// 行とデータの型の変換と検査。シートは直接触れるので、読むときは何も信じない。

import type {
  CategorySource,
  ForgottenItem,
  HistoryEntry,
  Item,
  RowIssue,
  RowOf,
  Store,
  SyncTable,
  TableRows,
} from "@shopping-list/core";

import type { Cell } from "./client.ts";
import { ID_PATTERN, ISO_PATTERN, TABLE_SHEETS, type SheetDef } from "./schema.ts";

const ID_RE = new RegExp(ID_PATTERN);
const ISO_RE = new RegExp(ISO_PATTERN);

export function isIso(value: Cell | undefined): value is string {
  return typeof value === "string" && ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function isId(value: Cell | undefined): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

const isEmpty = (cell: Cell | undefined) =>
  cell === undefined || cell === null || cell === "";

// チェックボックスの入力規則が掛かった空のセルは FALSE と読める。ID の無い行でそれしか無ければ空行とする
const isBlankRow = (cells: readonly Cell[]) =>
  isEmpty(cells[0]) && cells.every((cell) => isEmpty(cell) || cell === false || cell === "FALSE");

// 1行を読みながら問題を集める。問題があれば結果は使わない
class RowReader {
  readonly problems: RowIssue["problems"] = [];
  readonly #def: SheetDef;
  readonly #cells: readonly Cell[];

  constructor(def: SheetDef, cells: readonly Cell[]) {
    this.#def = def;
    this.#cells = cells;
  }

  #cell(column: string): Cell | undefined {
    return this.#cells[this.#def.columns.findIndex((c) => c.name === column)];
  }

  #fail(column: string, message: string): void {
    this.problems.push({ column, message });
  }

  id(column: string): string {
    const cell = this.#cell(column);
    if (!isId(cell)) this.#fail(column, "ID の形ではない");
    return String(cell);
  }

  optionalId(column: string): string | null {
    return isEmpty(this.#cell(column)) ? null : this.id(column);
  }

  idList(column: string): string[] {
    const cell = this.#cell(column);
    if (isEmpty(cell)) return [];
    const ids = String(cell).split(",");
    if (!ids.every((id) => isId(id))) this.#fail(column, "ID の並びの形ではない");
    return ids;
  }

  // 数字だけの品目名を手で入れると数で返ってくるので、文字列に戻す
  text(column: string): string {
    const cell = this.#cell(column);
    if (isEmpty(cell)) {
      this.#fail(column, "空にできない");
      return "";
    }
    return String(cell);
  }

  optionalText(column: string): string {
    const cell = this.#cell(column);
    return isEmpty(cell) ? "" : String(cell);
  }

  number(column: string): number {
    const cell = this.#cell(column);
    if (typeof cell !== "number" || !Number.isFinite(cell)) {
      this.#fail(column, "数ではない");
      return 0;
    }
    return cell;
  }

  optionalNumber(column: string, min: number, max: number): number | null {
    if (isEmpty(this.#cell(column))) return null;
    const value = this.number(column);
    if (value < min || value > max) this.#fail(column, `${min} から ${max} の外`);
    return value;
  }

  count(column: string): number {
    const value = this.number(column);
    if (!Number.isInteger(value) || value < 0) this.#fail(column, "0 以上の整数ではない");
    return value;
  }

  bool(column: string): boolean {
    const cell = this.#cell(column);
    if (cell === true || cell === "TRUE") return true;
    if (cell === false || cell === "FALSE") return false;
    this.#fail(column, "TRUE か FALSE ではない");
    return false;
  }

  iso(column: string): string {
    const cell = this.#cell(column);
    if (!isIso(cell)) this.#fail(column, "ISO 8601 の UTC の日時ではない");
    return String(cell);
  }

  optionalIso(column: string): string | null {
    return isEmpty(this.#cell(column)) ? null : this.iso(column);
  }

  categorySource(column: string): CategorySource | null {
    const cell = this.#cell(column);
    if (isEmpty(cell)) return null;
    if (cell === "history" || cell === "inferred" || cell === "user") return cell;
    this.#fail(column, "history、inferred、user のどれでもない");
    return null;
  }
}

interface Codec<T> {
  decode(reader: RowReader): T;
  encode(row: T): Cell[];
}

// deleted_at は行の型に持たない。読むときは decodeRow が返し、書くときは空にする
// (行全体を書くのは put だけで、put は行を生き返らせる)
const named: Codec<{ id: string; name: string; sort: number; updatedAt: string }> = {
  decode: (r) => ({
    id: r.id("id"),
    name: r.text("name"),
    sort: r.number("sort"),
    updatedAt: r.iso("updated_at"),
  }),
  encode: (row) => [row.id, row.name, row.sort, row.updatedAt, null],
};

const stores: Codec<Store> = {
  decode: (r) => {
    const lat = r.optionalNumber("lat", -90, 90);
    const lng = r.optionalNumber("lng", -180, 180);
    if ((lat === null) !== (lng === null)) {
      r.problems.push({ column: "lat", message: "緯度と経度は両方そろえる" });
    }
    return {
      id: r.id("id"),
      name: r.text("name"),
      lat,
      lng,
      createdAt: r.iso("created_at"),
      updatedAt: r.iso("updated_at"),
      listId: r.optionalId("list_id"),
    };
  },
  // 版を上げる前の送信待ちの行には listId が無い
  encode: (row) => [row.id, row.name, row.lat, row.lng, row.createdAt, row.updatedAt, null, row.listId ?? null],
};

const items: Codec<Item> = {
  decode: (r) => ({
    id: r.id("id"),
    listId: r.id("list_id"),
    name: r.text("name"),
    categoryId: r.optionalId("category_id"),
    categorySource: r.categorySource("category_source"),
    memo: r.optionalText("memo"),
    checked: r.bool("checked"),
    checkedAt: r.optionalIso("checked_at"),
    checkedStoreId: r.optionalId("checked_store_id"),
    checkedUpdatedAt: r.iso("checked_updated_at"),
    updatedAt: r.iso("updated_at"),
  }),
  encode: (row) => [
    row.id,
    row.listId,
    row.name,
    row.categoryId,
    row.categorySource,
    row.memo,
    row.checked,
    row.checkedAt,
    row.checkedStoreId,
    row.checkedUpdatedAt,
    row.updatedAt,
    null,
  ],
};

const history: Codec<HistoryEntry> = {
  decode: (r) => ({
    id: r.id("id"),
    listId: r.id("list_id"),
    name: r.text("name"),
    categoryId: r.optionalId("category_id"),
    categorySource: r.categorySource("category_source"),
    storeId: r.optionalId("store_id"),
    tripId: r.optionalId("trip_id"),
    checkedAt: r.iso("checked_at"),
    checkedSeq: r.count("checked_seq"),
  }),
  encode: (row) => [
    row.id,
    row.listId,
    row.name,
    row.categoryId,
    row.categorySource,
    row.storeId,
    row.tripId,
    row.checkedAt,
    row.checkedSeq,
  ],
};

const forgottenItems: Codec<ForgottenItem> = {
  decode: (r) => ({
    id: r.id("id"),
    listId: r.id("list_id"),
    normalizedName: r.text("normalized_name"),
    forgottenAt: r.iso("forgotten_at"),
    updatedAt: r.iso("updated_at"),
  }),
  encode: (row) => [row.id, row.listId, row.normalizedName, row.forgottenAt, row.updatedAt, null],
};

const CODECS: { [T in SyncTable]: Codec<TableRows[T]> } = {
  lists: named,
  categories: named,
  stores,
  items,
  history,
  forgottenItems,
  storeOrders: {
    decode: (r) => ({
      storeId: r.id("store_id"),
      categoryIds: r.idList("category_ids"),
      editedAt: r.iso("edited_at"),
    }),
    encode: (row) => [row.storeId, row.categoryIds.join(","), row.editedAt, null],
  },
};

export type Decoded<T extends SyncTable> =
  | { kind: "blank" }
  // deletedAt は墓石の時刻。効いているかは行の版と比べて決める(isTombstoned)
  | { kind: "row"; row: TableRows[T]; deletedAt: string | null }
  | { kind: "issue"; issue: RowIssue };

// rowNumber はシートの1始まりの行の位置。報告に使う
export function decodeRow<T extends SyncTable>(
  table: T,
  cells: readonly Cell[],
  rowNumber: number,
): Decoded<T> {
  if (isBlankRow(cells)) return { kind: "blank" };
  const reader = new RowReader(TABLE_SHEETS[table], cells);
  const row = CODECS[table].decode(reader);
  // History には列が無いので常に null になる
  const deletedAt = reader.optionalIso("deleted_at");
  if (reader.problems.length === 0) return { kind: "row", row, deletedAt };
  const first = cells[0];
  return {
    kind: "issue",
    issue: {
      table,
      row: rowNumber,
      id: isId(first) ? first : null,
      problems: reader.problems,
    },
  };
}

export function encodeRow<T extends SyncTable>(table: T, row: TableRows[T]): Cell[] {
  return CODECS[table].encode(row);
}

export function encodeChange(change: RowOf): Cell[] {
  return (CODECS[change.table] as Codec<unknown>).encode(change.row);
}
