// シートの定義。列の順はここが正で、codec と setup はこれに従う。

import type { SyncTable } from "@shopping-list/core";

export const SCHEMA_VERSION = 2;

export const ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$";
export const ID_LIST_PATTERN = "^([A-Za-z0-9_-]{1,64}(,[A-Za-z0-9_-]{1,64})*)?$";
// Date の toISOString の形。時差の解釈が割り込まないよう、シートには文字列のまま置く
export const ISO_PATTERN = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$";

export type ColumnKind =
  | "id" // 行の ID、または参照先を検査しない ID(History は消えたマスタを指せる)
  | "ref" // ほかのシートの ID。プルダウンで選ぶ
  | "idList" // コンマで区切った ID
  | "text"
  | "number"
  | "count" // 0 以上の整数
  | "bool"
  | "iso"
  | "enum";

export interface Column {
  name: string;
  kind: ColumnKind;
  // ref の参照先
  ref?: SheetName;
  // enum の値
  values?: readonly string[];
  min?: number;
  max?: number;
}

export type SheetName =
  | "Lists"
  | "Categories"
  | "Stores"
  | "Items"
  | "History"
  | "StoreOrders"
  | "Meta";

export interface SheetDef {
  name: SheetName;
  // 作るときに固定する番号。既定の sheetId 0 と重ならないようにする
  sheetId: number;
  // 入力規則は作るときの行の範囲に掛かるので、はじめから余裕を持たせる
  rowCount: number;
  columns: readonly Column[];
}

const id = (name: string): Column => ({ name, kind: "id" });
const ref = (name: string, target: SheetName): Column => ({
  name,
  kind: "ref",
  ref: target,
});
const text = (name: string): Column => ({ name, kind: "text" });
const iso = (name: string): Column => ({ name, kind: "iso" });

const CATEGORY_SOURCES = ["history", "inferred", "user"] as const;

export const SHEETS: readonly SheetDef[] = [
  {
    name: "Lists",
    sheetId: 101,
    rowCount: 200,
    columns: [
      id("id"),
      text("name"),
      { name: "sort", kind: "number" },
      iso("updated_at"),
      iso("deleted_at"),
    ],
  },
  {
    name: "Categories",
    sheetId: 102,
    rowCount: 200,
    columns: [
      id("id"),
      text("name"),
      { name: "sort", kind: "number" },
      iso("updated_at"),
      iso("deleted_at"),
    ],
  },
  {
    name: "Stores",
    sheetId: 103,
    rowCount: 500,
    columns: [
      id("id"),
      text("name"),
      { name: "lat", kind: "number", min: -90, max: 90 },
      { name: "lng", kind: "number", min: -180, max: 180 },
      iso("created_at"),
      iso("updated_at"),
      iso("deleted_at"),
    ],
  },
  {
    name: "Items",
    sheetId: 104,
    rowCount: 2000,
    columns: [
      id("id"),
      ref("list_id", "Lists"),
      text("name"),
      ref("category_id", "Categories"),
      { name: "category_source", kind: "enum", values: CATEGORY_SOURCES },
      text("memo"),
      { name: "checked", kind: "bool" },
      iso("checked_at"),
      ref("checked_store_id", "Stores"),
      iso("updated_at"),
      iso("deleted_at"),
    ],
  },
  {
    name: "History",
    sheetId: 105,
    rowCount: 20000,
    columns: [
      id("id"),
      id("list_id"),
      text("name"),
      id("category_id"),
      { name: "category_source", kind: "enum", values: CATEGORY_SOURCES },
      id("store_id"),
      id("trip_id"),
      iso("checked_at"),
      { name: "checked_seq", kind: "count" },
    ],
  },
  {
    name: "StoreOrders",
    sheetId: 106,
    rowCount: 500,
    columns: [
      ref("store_id", "Stores"),
      { name: "category_ids", kind: "idList" },
      iso("edited_at"),
      iso("deleted_at"),
    ],
  },
  {
    name: "Meta",
    sheetId: 107,
    rowCount: 10,
    columns: [{ name: "schema_version", kind: "count" }],
  },
];

function sheet(name: SheetName): SheetDef {
  const def = SHEETS.find((candidate) => candidate.name === name);
  if (def === undefined) throw new Error(`シートの定義が無い: ${name}`);
  return def;
}

export const META_SHEET = sheet("Meta");

export const TABLE_SHEETS: Readonly<Record<SyncTable, SheetDef>> = {
  lists: sheet("Lists"),
  categories: sheet("Categories"),
  stores: sheet("Stores"),
  items: sheet("Items"),
  storeOrders: sheet("StoreOrders"),
  history: sheet("History"),
};

export const HISTORY_SHEET = TABLE_SHEETS.history;

// 列の位置。無い列は -1
export function columnIndex(def: SheetDef, name: string): number {
  return def.columns.findIndex((column) => column.name === name);
}

// 0 始まりの列の番号を A、B、… にする
export function columnLetter(index: number): string {
  let letters = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
  }
  return letters;
}

// 見出しを除いたデータの範囲。fromRow は1始まり
export function dataRange(def: SheetDef, fromRow = 2): string {
  const last = columnLetter(def.columns.length - 1);
  return `${def.name}!A${fromRow}:${last}`;
}

export function headerRange(def: SheetDef): string {
  const last = columnLetter(def.columns.length - 1);
  return `${def.name}!A1:${last}1`;
}
