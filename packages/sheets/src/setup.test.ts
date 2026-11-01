import { describe, expect, it } from "vitest";

import { INITIAL_CATEGORIES, buildSetupRequests } from "./setup.ts";
import { SHEETS, TABLE_SHEETS } from "./schema.ts";
import { parseSpreadsheetId } from "./spreadsheetId.ts";

type Req = Record<string, Record<string, any>>;

const requests = buildSetupRequests(0) as Req[];
const of = (name: string) => requests.flatMap((r) => (r[name] ? [r[name]] : []));
const items = TABLE_SHEETS.items;
const column = (name: string) => items.columns.findIndex((c) => c.name === name);
const ruleOn = (sheetId: number, index: number) =>
  of("setDataValidation").find(
    (r) => r.range.sheetId === sheetId && r.range.startColumnIndex === index,
  )?.rule;

describe("buildSetupRequests", () => {
  it("すべてのシートを足してから、既定のシートを消す", () => {
    const names = requests.map((r) => Object.keys(r)[0]);
    expect(of("addSheet").map((r) => r.properties.title)).toEqual(
      SHEETS.map((def) => def.name),
    );
    expect(names.indexOf("deleteSheet")).toBe(SHEETS.length);
  });

  it("見出しは設計の列のとおり", () => {
    const header = of("updateCells").find((r) => r.start.sheetId === items.sheetId);
    expect(
      header?.rows[0].values.map((c: any) => c.userEnteredValue.stringValue),
    ).toEqual([
      "id",
      "list_id",
      "name",
      "category_id",
      "category_source",
      "memo",
      "checked",
      "checked_at",
      "checked_store_id",
      "updated_at",
    ]);
  });

  it("checked はチェックボックスで strict", () => {
    expect(ruleOn(items.sheetId, column("checked"))).toMatchObject({
      condition: { type: "BOOLEAN" },
      strict: true,
    });
  });

  it("リストとカテゴリの列は ID のプルダウン", () => {
    expect(ruleOn(items.sheetId, column("list_id"))).toMatchObject({
      condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "=Lists!$A$2:$A" }] },
      strict: true,
      showCustomUi: true,
    });
    expect(ruleOn(items.sheetId, column("category_id")).condition.values).toEqual([
      { userEnteredValue: "=Categories!$A$2:$A" },
    ]);
  });

  it("ID と日時の列は形式を検査する", () => {
    expect(ruleOn(items.sheetId, 0).condition.values[0].userEnteredValue).toContain(
      "REGEXMATCH(TO_TEXT(A2)",
    );
    expect(
      ruleOn(items.sheetId, column("updated_at")).condition.values[0].userEnteredValue,
    ).toContain("REGEXMATCH(TO_TEXT(J2)");
  });

  it("すべてのシートに warningOnly の保護を付ける", () => {
    const protections = of("addProtectedRange");
    expect(protections).toHaveLength(SHEETS.length);
    expect(protections.every((r) => r.protectedRange.warningOnly === true)).toBe(true);
  });

  it("初期のカテゴリとスキーマの版を入れる", () => {
    const [categories, meta] = of("appendCells");
    expect(categories?.rows).toHaveLength(INITIAL_CATEGORIES.length);
    expect(categories?.rows[0].values[1].userEnteredValue.stringValue).toBe("鮮魚");
    expect(meta?.rows[0].values[0].userEnteredValue.numberValue).toBe(1);
    expect(new Set(INITIAL_CATEGORIES.map((c) => c.id)).size).toBe(
      INITIAL_CATEGORIES.length,
    );
  });
});

describe("parseSpreadsheetId", () => {
  const id = "1AbC-dEf_GhIjKlMnOpQrStUvWxYz0123456789";

  it.each([
    `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`,
    `https://docs.google.com/spreadsheets/d/${id}`,
    `https://docs.google.com/spreadsheets/u/1/d/${id}/edit?usp=sharing`,
    `docs.google.com/spreadsheets/d/${id}/edit`,
    `  ${id}\n`,
  ])("%s から取り出す", (input) => {
    expect(parseSpreadsheetId(input)).toBe(id);
  });

  it.each([
    "https://example.com/spreadsheets/d/abc/edit",
    "https://docs.google.com/document/d/abc/edit",
    "https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml",
    "買い物",
    "",
  ])("%s は取り出さない", (input) => {
    expect(parseSpreadsheetId(input)).toBeNull();
  });
});
