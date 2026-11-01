import { describe, expect, it } from "vitest";
import { normalizeItemName } from "./normalize.ts";

describe("normalizeItemName", () => {
  it("カタカナと半角カナをひらがなにそろえる", () => {
    expect(normalizeItemName("タマゴ")).toBe("たまご");
    expect(normalizeItemName("ﾀﾏｺﾞ")).toBe("たまご");
  });

  it("長音はそのまま残す", () => {
    expect(normalizeItemName("ヨーグルト")).toBe("よーぐると");
  });

  it("全角の英数字をそろえて小文字にする", () => {
    expect(normalizeItemName("ＡＢＣ１２")).toBe("abc12");
    expect(normalizeItemName("Milk")).toBe("milk");
  });

  it("前後の空白を除き、中の空白は残す", () => {
    expect(normalizeItemName("　 牛乳 1本\t")).toBe("牛乳 1本");
  });
});
