import { INFERENCE_DICTIONARY } from "@shopping-list/core";
import { describe, expect, it } from "vitest";

import { INITIAL_CATEGORIES, buildSetupRequests } from "./setup.ts";
import { SCHEMA_VERSION, SHEETS, TABLE_SHEETS } from "./schema.ts";
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
      "checked_updated_at",
      "updated_at",
      "deleted_at",
    ]);
  });

  // BOOLEAN にすると空のセルが FALSE と読め、新しい行が入力規則の範囲の外に足される
  it("checked は真偽値だけを許し、チェックボックスにはしない", () => {
    const rule = ruleOn(items.sheetId, column("checked"));
    expect(rule).toMatchObject({ condition: { type: "CUSTOM_FORMULA" }, strict: true });
    expect(JSON.stringify(rule)).toContain("ISLOGICAL");
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
    ).toContain("REGEXMATCH(TO_TEXT(K2)");
  });

  it("店舗のリストは空を許す Lists のプルダウン", () => {
    const stores = TABLE_SHEETS.stores;
    const index = stores.columns.findIndex((c) => c.name === "list_id");
    expect(index).toBe(stores.columns.length - 1);
    expect(ruleOn(stores.sheetId, index)).toMatchObject({
      condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "=Lists!$A$2:$A" }] },
    });
  });

  it("行を持つ表は、History を除いて deleted_at を持つ", () => {
    const names = SHEETS.filter((def) => def.columns.some((c) => c.name === "deleted_at"));
    expect(names.map((def) => def.name)).toEqual([
      "Lists",
      "Categories",
      "Stores",
      "Items",
      "StoreOrders",
    ]);
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
    expect(meta?.rows[0].values[0].userEnteredValue.numberValue).toBe(
      SCHEMA_VERSION,
    );
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

describe("INITIAL_CATEGORIES", () => {
  it("推定の辞書のキーは初期のカテゴリの名前と一致する", () => {
    expect(Object.keys(INFERENCE_DICTIONARY).sort()).toEqual(INITIAL_CATEGORIES.map((c) => c.name).sort());
  });
});
