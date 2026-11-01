// Sheets API の CellData の組み立て。setup と sheetsRemote で使う。

import type { Cell } from "./client.ts";

// 文字列は stringValue で渡すので、"=1+1" も数式にならない
export function cellData(cell: Cell): Record<string, unknown> {
  if (cell === null || cell === "") return {};
  if (typeof cell === "number") return { userEnteredValue: { numberValue: cell } };
  if (typeof cell === "boolean") return { userEnteredValue: { boolValue: cell } };
  return { userEnteredValue: { stringValue: cell } };
}

export function rowData(cells: readonly Cell[]): Record<string, unknown> {
  return { values: cells.map(cellData) };
}
