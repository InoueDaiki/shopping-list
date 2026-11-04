// シートの定義。列の順はここが正で、codec と setup はこれに従う。

import type { SyncTable } from "@shopping-list/core";

export const SCHEMA_VERSION = 7;

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
  | "Meta"
  | "Presence"
  | "ForgottenItems";

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
      // 既存の行の列をずらさないよう、deleted_at の後に足した
      ref("list_id", "Lists"),
    ],
  },
  {
    name: "Items",
    sheetId: 104,
    rowCount: 2000,
    columns: [
      id("id"),
      // 空はどのリストにも属さない品目(野良品目)。版 7 から空を許す(プルダウンの入力規則は空のセルを検査しない)
      ref("list_id", "Lists"),
      text("name"),
      ref("category_id", "Categories"),
      { name: "category_source", kind: "enum", values: CATEGORY_SOURCES },
      text("memo"),
      { name: "checked", kind: "bool" },
      iso("checked_at"),
      ref("checked_store_id", "Stores"),
      iso("checked_updated_at"),
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
    columns: [
      { name: "schema_version", kind: "count" },
      // 変更の印。書くたびに「書いた時刻/端末ID」を置く。読むのはこのセルと Presence だけで、
      // 変わったときにだけ全部を読む
      text("last_write"),
    ],
  },
  {
    // 在室の記録。同期の表(SyncTable)ではなく、墓石も履歴も持たない。行は端末ごとに1つで上書きする
    name: "Presence",
    sheetId: 108,
    rowCount: 50,
    columns: [id("device_id"), id("list_id"), iso("until"), iso("updated_at")],
  },
  {
    // 品目名を忘れた記録。リストごとに、この時刻までに買った同じ名前の履歴を、候補などから除く
    name: "ForgottenItems",
    sheetId: 109,
    rowCount: 500,
    columns: [
      id("id"),
      ref("list_id", "Lists"),
      // 正規化した品目名(normalizeItemName)。表記の揺れをまとめて忘れる
      text("normalized_name"),
      iso("forgotten_at"),
      iso("updated_at"),
      iso("deleted_at"),
    ],
  },
];

function sheet(name: SheetName): SheetDef {
  const def = SHEETS.find((candidate) => candidate.name === name);
  if (def === undefined) throw new Error(`シートの定義が無い: ${name}`);
  return def;
}

export const META_SHEET = sheet("Meta");
export const PRESENCE_SHEET = sheet("Presence");
// Meta の版と変更の印(A2 と B2)
export const META_RANGE = `${META_SHEET.name}!A2:B2`;

export const TABLE_SHEETS: Readonly<Record<SyncTable, SheetDef>> = {
  lists: sheet("Lists"),
  categories: sheet("Categories"),
  stores: sheet("Stores"),
  items: sheet("Items"),
  storeOrders: sheet("StoreOrders"),
  forgottenItems: sheet("ForgottenItems"),
  history: sheet("History"),
};

export const HISTORY_SHEET = TABLE_SHEETS.history;

// Items のチェックの状態の列。checked_updated_at はこれらの版で、updated_at は残りの列の版
export const ITEM_CHECK_COLUMNS = [
  "checked",
  "checked_at",
  "checked_store_id",
  "checked_updated_at",
] as const;

export interface Upgrade {
  // この版のシートを、次の版へ上げる
  from: number;
  // 足した列。どれも各シートの末尾にある
  columns: Partial<Record<SheetName, readonly string[]>>;
  // 足したシート
  sheets: readonly SheetName[];
}

// 自動で上げられる前の版と、そこから足したもの。古い順に並べ、最後の次が SCHEMA_VERSION
export const UPGRADES: readonly Upgrade[] = [
  { from: 3, columns: { Stores: ["list_id"] }, sheets: [] },
  { from: 4, columns: { Meta: ["last_write"] }, sheets: ["Presence"] },
  { from: 5, columns: {}, sheets: ["ForgottenItems"] },
  // Items の list_id を空にできるようにした(野良品目)。列もシートも足さず、版だけを上げる。
  // 前の版のアプリは空の list_id を読めないので、版を合わせて同期を止めさせる
  { from: 6, columns: {}, sheets: [] },
];

// version から今の版までに足したもの。上げられない版なら null
export function addedSince(version: unknown): Omit<Upgrade, "from"> | null {
  const start = UPGRADES.findIndex((upgrade) => upgrade.from === version);
  if (start < 0) return null;
  const columns: Partial<Record<SheetName, string[]>> = {};
  const sheets: SheetName[] = [];
  for (const upgrade of UPGRADES.slice(start)) {
    for (const [name, added] of Object.entries(upgrade.columns) as [SheetName, readonly string[]][]) {
      (columns[name] ??= []).push(...added);
    }
    sheets.push(...upgrade.sheets);
  }
  return { columns, sheets };
}

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

// columnCount はシートの今の列の数。シートの外を指すと範囲ごと拒否されるので、その中に収める
export function headerRange(def: SheetDef, columnCount = def.columns.length): string {
  const last = columnLetter(Math.min(def.columns.length, columnCount) - 1);
  return `${def.name}!A1:${last}1`;
}
