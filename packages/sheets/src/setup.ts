// スプレッドシートの作成と、作るときの batchUpdate の組み立て。

import { RemoteError, type Category } from "@shopping-list/core";

import { rowData } from "./cells.ts";
import type { Cell, SheetsClient, SheetsRequest, ValueRange } from "./client.ts";
import { encodeRow } from "./codec.ts";
import {
  ID_LIST_PATTERN,
  ID_PATTERN,
  ISO_PATTERN,
  META_SHEET,
  SCHEMA_VERSION,
  SHEETS,
  TABLE_SHEETS,
  addedSince,
  columnLetter,
  headerRange,
  type Column,
  type SheetDef,
  type SheetName,
  type Upgrade,
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

// 初期のカテゴリの版。どの編集よりも古い固定の値にする
const SEED_AT = "2000-01-01T00:00:00.000Z";

export const INITIAL_CATEGORIES: readonly Category[] = CATEGORY_NAMES.map(
  ([key, name], index) => ({ id: `cat_${key}`, name, sort: index + 1, updatedAt: SEED_AT }),
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
      // BOOLEAN の入力規則は使わない。空のセルが FALSE と読めてデータのある行に数えられ、
      // 新しい行が範囲の外に足されるため
      return {
        type: "CUSTOM_FORMULA",
        values: [{ userEnteredValue: `=ISLOGICAL(${cell})` }],
      };
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

// fromColumn より右の列の書式と入力規則
function columnRequests(def: SheetDef, fromColumn = 0): SheetsRequest[] {
  return def.columns.flatMap((column, index) => {
    if (index < fromColumn) return [];
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

export type SheetIds = Record<SheetName, number>;

export function assertSchemaVersion(range: ValueRange | undefined): void {
  const version = range?.values?.[0]?.[0];
  if (version !== SCHEMA_VERSION) {
    throw new RemoteError(
      "schema",
      `スキーマの版が合わない: シート ${String(version)}、アプリ ${SCHEMA_VERSION}`,
    );
  }
}

export interface SpreadsheetSurvey {
  // 足りないシートの名前。空ならアプリの形。前の版で上げると足すシートは含めない
  missing: SheetName[];
  // 今あるアプリのシートの番号
  sheetIds: Partial<SheetIds>;
  // 今あるアプリのシートの列の数
  columnCounts: Partial<Record<SheetName, number>>;
  // アプリのシートも含む、すべてのシートの番号
  allSheetIds: number[];
  // 前の版で、upgradeSpreadsheet で上げられる
  outdated: boolean;
  // 前の版から足すもの。outdated のときだけ
  added: Omit<Upgrade, "from"> | null;
}

// 見出しが定義のとおりか。前の版のシートには足す列がまだ無い
function headerMatches(def: SheetDef, header: readonly Cell[], added: readonly string[]): boolean {
  return def.columns.every(
    (column, i) => header[i] === column.name || (header[i] === undefined && added.includes(column.name)),
  );
}

// シートの形を調べる。読むだけで何も書かない。アプリと同じ名前のシートが別の列や
// 別の版なら、触らないよう RemoteError(schema)に原因を入れて投げる
export async function surveySpreadsheet(
  client: SheetsClient,
  spreadsheetId: string,
): Promise<SpreadsheetSurvey> {
  const spreadsheet = await client.get(
    spreadsheetId,
    "spreadsheetId,sheets.properties(sheetId,title,gridProperties(columnCount))",
  );
  const all = (spreadsheet.sheets ?? []).map(({ properties }) => properties);
  const found = new Map(all.map(({ title, sheetId }) => [title, sheetId]));
  const present = SHEETS.filter((def) => found.has(def.name));
  const absent = SHEETS.filter((def) => !found.has(def.name)).map((def) => def.name);
  const sheetIds = Object.fromEntries(
    present.map((def) => [def.name, found.get(def.name) as number]),
  ) as Partial<SheetIds>;
  const counts = new Map(all.map(({ title, gridProperties }) => [title, gridProperties?.columnCount]));
  const columnCounts = Object.fromEntries(
    present.map((def) => [def.name, counts.get(def.name)]),
  ) as Partial<Record<SheetName, number>>;
  const allSheetIds = [...found.values()];
  const hasMeta = found.has(META_SHEET.name);
  const ranges = [
    ...(hasMeta ? [`${META_SHEET.name}!A2`] : []),
    ...present.map((def) => headerRange(def, columnCounts[def.name])),
  ];
  if (ranges.length === 0) {
    return { missing: absent, sheetIds, columnCounts, allSheetIds, outdated: false, added: null };
  }

  const values = await client.batchGet(spreadsheetId, ranges);
  const added = hasMeta ? addedSince(values[0]?.values?.[0]?.[0]) : null;
  const headers = hasMeta ? values.slice(1) : values;
  const conflicts = present.filter(
    (def, index) =>
      !headerMatches(def, headers[index]?.values?.[0] ?? [], added?.columns[def.name] ?? []),
  );
  if (conflicts.length > 0) {
    const names = conflicts.map((def) => def.name).join("、");
    throw new RemoteError("schema", `同じ名前で列の違うシートがある: ${names}`);
  }
  if (hasMeta && added === null) assertSchemaVersion(values[0]);
  const missing = absent.filter((name) => !(added?.sheets.includes(name) ?? false));
  return { missing, sheetIds, columnCounts, allSheetIds, outdated: added !== null, added };
}

// 前の版のシートを上げる要求と、上げた後のシートの番号。列を足すのは末尾だけで、データの行のセルには触らない。
// 列の要求は同じ結果を置くだけなので、2台が同時に送っても壊れない。シートを足す要求だけは、
// 後の1台では同じ名前のシートがあるので拒否される(upgradeSpreadsheet が調べ直す)
function upgradeRequests(survey: SpreadsheetSurvey): {
  requests: SheetsRequest[];
  placed: SheetDef[];
} {
  const { sheetIds, columnCounts, allSheetIds, added } = survey;
  const columns = SHEETS.flatMap((def): SheetsRequest[] => {
    const sheetId = sheetIds[def.name];
    const names = added?.columns[def.name];
    if (sheetId === undefined || names === undefined) return [];
    const placed = { ...def, sheetId };
    // 足りるときは触らない。列の数を減らすと、手で足した列が消える
    const widen: SheetsRequest[] =
      (columnCounts[def.name] ?? 0) >= def.columns.length
        ? []
        : [
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { columnCount: def.columns.length } },
                fields: "gridProperties.columnCount",
              },
            },
          ];
    return [...widen, header(placed), ...columnRequests(placed, def.columns.length - names.length)];
  });
  const missing = SHEETS.filter(
    (def) => (added?.sheets.includes(def.name) ?? false) && sheetIds[def.name] === undefined,
  );
  const placed = withFreeSheetIds(missing, allSheetIds);
  const version: SheetsRequest = {
    updateCells: {
      start: { sheetId: sheetIds.Meta, rowIndex: 1, columnIndex: 0 },
      rows: [rowData([SCHEMA_VERSION])],
      fields: "userEnteredValue",
    },
  };
  return { requests: [...columns, ...buildAddRequests(placed, null, []), version], placed };
}

// 前の版のシートを、データを失わずに今の版へ上げ、上げた後の形を返す。今の版なら何もしない。
// 1回の batchUpdate なので、途中の形をほかの端末に見せず、失敗してももう一度呼べる。
// 拒否されたら調べ直し、ほかの端末が先に上げていれば、それを使う
export async function upgradeSpreadsheet(
  client: SheetsClient,
  spreadsheetId: string,
  survey: SpreadsheetSurvey,
): Promise<SpreadsheetSurvey> {
  if (!survey.outdated) return survey;
  const { requests, placed } = upgradeRequests(survey);
  try {
    await client.batchUpdate(spreadsheetId, requests);
  } catch (error) {
    if (!(error instanceof RemoteError) || error.kind !== "invalid") throw error;
    const again = await surveySpreadsheet(client, spreadsheetId);
    if (again.outdated) throw error;
    return again;
  }
  const columnCounts = { ...survey.columnCounts };
  for (const name of Object.keys(survey.added?.columns ?? {}) as SheetName[]) {
    const def = SHEETS.find((candidate) => candidate.name === name);
    if (def !== undefined) columnCounts[name] = Math.max(columnCounts[name] ?? 0, def.columns.length);
  }
  for (const def of placed) columnCounts[def.name] = def.columns.length;
  return {
    ...survey,
    sheetIds: { ...survey.sheetIds, ...Object.fromEntries(placed.map((def) => [def.name, def.sheetId])) },
    columnCounts,
    allSheetIds: [...survey.allSheetIds, ...placed.map((def) => def.sheetId)],
    outdated: false,
    added: null,
  };
}

// シートの番号が、今あるシートと重ならないようにする(既存のスプレッドシートに足すとき)
function withFreeSheetIds(defs: readonly SheetDef[], used: readonly number[]): SheetDef[] {
  const taken = new Set(used);
  return defs.map((def) => {
    let sheetId = def.sheetId;
    while (taken.has(sheetId)) sheetId += 1000;
    taken.add(sheetId);
    return { ...def, sheetId };
  });
}

// シートを足す要求。defaultSheetId は消してよい既定のシート(自分で作ったものだけ渡す)
function buildAddRequests(
  defs: readonly SheetDef[],
  defaultSheetId: number | null,
  categories: readonly Category[],
): SheetsRequest[] {
  const seeds = defs.flatMap((def): SheetsRequest[] => {
    if (def.name === TABLE_SHEETS.categories.name) {
      return [seed(def, categories.map((category) => encodeRow("categories", category)))];
    }
    return def.name === META_SHEET.name ? [seed(def, [[SCHEMA_VERSION]])] : [];
  });
  return [
    ...defs.map(addSheet),
    ...(defaultSheetId === null ? [] : [{ deleteSheet: { sheetId: defaultSheetId } }]),
    ...defs.map(header),
    ...seeds,
    ...defs.flatMap((def) => columnRequests(def)),
    ...defs.map(protect),
  ];
}

// 作成直後の batchUpdate の要求。defaultSheetId は create が作った最初のシートで、最後に消す
export function buildSetupRequests(
  defaultSheetId: number,
  categories: readonly Category[] = INITIAL_CATEGORIES,
): SheetsRequest[] {
  return buildAddRequests(SHEETS, defaultSheetId, categories);
}

export interface EnsureOptions {
  // 中身の無い、アプリが作った既定のシート。足し終えるときに消す。貼られたシートでは渡さない
  defaultSheetId?: number;
}

// 足りないシートを足して初期化する。あるシートは、前の版なら上げるほかは触らない。
// 1回の batchUpdate なので、全部足せるか何も変わらないかになり、失敗してももう一度呼べば続きになる
export async function ensureSpreadsheet(
  client: SheetsClient,
  spreadsheetId: string,
  options: EnsureOptions = {},
): Promise<void> {
  const survey = await upgradeSpreadsheet(
    client,
    spreadsheetId,
    await surveySpreadsheet(client, spreadsheetId),
  );
  const { missing, allSheetIds } = survey;
  if (missing.length === 0) return;
  const defs = SHEETS.filter((def) => missing.includes(def.name));
  const { defaultSheetId = null } = options;
  const removable = defaultSheetId !== null && allSheetIds.includes(defaultSheetId);
  await client.batchUpdate(
    spreadsheetId,
    buildAddRequests(
      withFreeSheetIds(defs, allSheetIds),
      removable ? defaultSheetId : null,
      INITIAL_CATEGORIES,
    ),
  );
}

export interface CreatedSpreadsheet {
  spreadsheetId: string;
  // もう1人に渡す URL
  spreadsheetUrl: string;
  // 既定のシートの番号。初期化で消す
  defaultSheetId: number;
}

// 空のスプレッドシートを作る。続きは ensureSpreadsheet で行う。呼び出し側が ID を
// 保存してから続けると、途中で失敗しても空のシートを増やさない
export async function beginSpreadsheet(
  client: SheetsClient,
  title: string,
): Promise<CreatedSpreadsheet> {
  const created = await client.create(title);
  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl:
      created.spreadsheetUrl ??
      `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
    defaultSheetId: created.sheets?.[0]?.properties.sheetId ?? 0,
  };
}

// 1人目の初期化。シートを作り、規則と初期のカテゴリを入れる
export async function createSpreadsheet(
  client: SheetsClient,
  title: string,
): Promise<CreatedSpreadsheet> {
  const created = await beginSpreadsheet(client, title);
  await ensureSpreadsheet(client, created.spreadsheetId, {
    defaultSheetId: created.defaultSheetId,
  });
  return created;
}
