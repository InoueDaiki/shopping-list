// スプレッドシートの作成と、作るときの batchUpdate の組み立て。

import type { Category } from "@shopping-list/core";

import { rowData } from "./cells.ts";
import type { Cell, SheetsClient, SheetsRequest } from "./client.ts";
import { encodeRow } from "./codec.ts";
import {
  ID_LIST_PATTERN,
  ID_PATTERN,
  ISO_PATTERN,
  META_SHEET,
  SCHEMA_VERSION,
  SHEETS,
  TABLE_SHEETS,
  columnLetter,
  type Column,
  type SheetDef,
} from "./schema.ts";

const CATEGORY_NAMES: readonly (readonly [string, string])[] = [
  ["seafood", "鮮魚"],
  ["meat", "生肉"],
  ["dairy", "乳製品"],
  ["vegetables", "野菜"],
  ["fruit", "果物"],
  ["eggs", "卵"],
  ["tofu_natto", "豆腐・納豆"],
  ["bread", "パン"],
  ["noodles_rice", "麺・米"],
  ["seasonings", "調味料"],
  ["frozen", "冷凍"],
  ["snacks", "菓子"],
  ["drinks", "飲料"],
  ["alcohol", "酒"],
  ["household", "日用品"],
  ["medicine", "医薬品"],
];

export const INITIAL_CATEGORIES: readonly Category[] = CATEGORY_NAMES.map(
  ([key, name], index) => ({ id: `cat_${key}`, name, sort: index + 1 }),
);

const TEXT_KINDS: ReadonlySet<Column["kind"]> = new Set([
  "id",
  "ref",
  "idList",
  "text",
  "iso",
  "enum",
]);

function regexCondition(cell: string, pattern: string) {
  return {
    type: "CUSTOM_FORMULA",
    values: [{ userEnteredValue: `=REGEXMATCH(TO_TEXT(${cell}),"${pattern}")` }],
  };
}

// 入力規則の条件。text は何でも入れられるので規則を持たない
function condition(column: Column, cell: string): Record<string, unknown> | null {
  switch (column.kind) {
    case "id":
      return regexCondition(cell, ID_PATTERN);
    case "idList":
      return regexCondition(cell, ID_LIST_PATTERN);
    case "iso":
      return regexCondition(cell, ISO_PATTERN);
    case "ref":
      return {
        type: "ONE_OF_RANGE",
        values: [{ userEnteredValue: `=${column.ref}!$A$2:$A` }],
      };
    case "enum":
      return {
        type: "ONE_OF_LIST",
        values: (column.values ?? []).map((value) => ({ userEnteredValue: value })),
      };
    case "bool":
      // BOOLEAN の入力規則がチェックボックスになる
      return { type: "BOOLEAN" };
    case "number":
      return column.min !== undefined && column.max !== undefined
        ? {
            type: "NUMBER_BETWEEN",
            values: [
              { userEnteredValue: String(column.min) },
              { userEnteredValue: String(column.max) },
            ],
          }
        : {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: `=ISNUMBER(${cell})` }],
          };
    case "count":
      return {
        type: "CUSTOM_FORMULA",
        values: [
          { userEnteredValue: `=AND(ISNUMBER(${cell}),${cell}>=0,${cell}=INT(${cell}))` },
        ],
      };
    case "text":
      return null;
  }
}

function addSheet(def: SheetDef): SheetsRequest {
  return {
    addSheet: {
      properties: {
        sheetId: def.sheetId,
        title: def.name,
        gridProperties: {
          rowCount: def.rowCount,
          columnCount: def.columns.length,
          frozenRowCount: 1,
        },
      },
    },
  };
}

function header(def: SheetDef): SheetsRequest {
  return {
    updateCells: {
      start: { sheetId: def.sheetId, rowIndex: 0, columnIndex: 0 },
      rows: [rowData(def.columns.map((column) => column.name))],
      fields: "userEnteredValue",
    },
  };
}

function seed(def: SheetDef, rows: Cell[][]): SheetsRequest {
  return {
    appendCells: {
      sheetId: def.sheetId,
      rows: rows.map(rowData),
      fields: "userEnteredValue",
    },
  };
}

function columnRange(def: SheetDef, index: number) {
  return {
    sheetId: def.sheetId,
    startRowIndex: 1,
    startColumnIndex: index,
    endColumnIndex: index + 1,
  };
}

function columnRequests(def: SheetDef): SheetsRequest[] {
  return def.columns.flatMap((column, index) => {
    const requests: SheetsRequest[] = [];
    const range = columnRange(def, index);
    if (TEXT_KINDS.has(column.kind)) {
      // 手で直したときに日付や数へ自動で変わらないよう、書式をテキストにする
      requests.push({
        repeatCell: {
          range,
          cell: { userEnteredFormat: { numberFormat: { type: "TEXT" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    }
    const rule = condition(column, `${columnLetter(index)}2`);
    if (rule !== null) {
      requests.push({
        setDataValidation: {
          range,
          rule: { condition: rule, strict: true, showCustomUi: true },
        },
      });
    }
    return requests;
  });
}

function protect(def: SheetDef): SheetsRequest {
  return {
    addProtectedRange: {
      protectedRange: {
        range: { sheetId: def.sheetId },
        description: "アプリが管理するシート",
        warningOnly: true,
      },
    },
  };
}

// 作成直後の batchUpdate の要求。defaultSheetId は create が作った最初のシートで、最後に消す
export function buildSetupRequests(
  defaultSheetId: number,
  categories: readonly Category[] = INITIAL_CATEGORIES,
): SheetsRequest[] {
  return [
    ...SHEETS.map(addSheet),
    { deleteSheet: { sheetId: defaultSheetId } },
    ...SHEETS.map(header),
    seed(
      TABLE_SHEETS.categories,
      categories.map((category) => encodeRow("categories", category)),
    ),
    seed(META_SHEET, [[SCHEMA_VERSION]]),
    ...SHEETS.flatMap(columnRequests),
    ...SHEETS.map(protect),
  ];
}

export interface CreatedSpreadsheet {
  spreadsheetId: string;
  // もう1人に渡す URL
  spreadsheetUrl: string;
}

// 1人目の初期化。シートを作り、規則と初期のカテゴリを入れる
export async function createSpreadsheet(
  client: SheetsClient,
  title: string,
): Promise<CreatedSpreadsheet> {
  const created = await client.create(title);
  const defaultSheetId = created.sheets?.[0]?.properties.sheetId ?? 0;
  await client.batchUpdate(created.spreadsheetId, buildSetupRequests(defaultSheetId));
  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl:
      created.spreadsheetUrl ??
      `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
  };
}
