import { describe, expect, it } from "vitest";

import { contrastRatio, inSrgbGamut, oklch, toHex } from "./color.ts";
import { colors, contrastPairs } from "./tokens.ts";

describe("色の変換", () => {
  it("白と黒を HEX にする", () => {
    expect(toHex(oklch(1, 0, 0))).toBe("#ffffff");
    expect(toHex(oklch(0, 0, 0))).toBe("#000000");
  });

  it("半透明は8桁の HEX にする", () => {
    expect(toHex(oklch(0, 0, 0, 0.5))).toBe("#00000080");
  });

  it("白と黒のコントラスト比は21", () => {
    expect(contrastRatio(oklch(1, 0, 0), oklch(0, 0, 0))).toBeCloseTo(21, 1);
  });
});

describe("トークン", () => {
  // 範囲の外の色は端末ごとに丸め方が違い、見え方がずれる
  it.each(Object.entries(colors))("%s は sRGB に収まる", (_name, token) => {
    expect(inSrgbGamut(token.light)).toBe(true);
    expect(inSrgbGamut(token.dark)).toBe(true);
  });

  for (const scheme of ["light", "dark"] as const) {
    it.each(contrastPairs)(`${scheme}: $fg / $bg のコントラスト比が $min 以上`, ({ fg, bg, min }) => {
      expect(contrastRatio(colors[fg][scheme], colors[bg][scheme])).toBeGreaterThanOrEqual(min);
    });
  }
});
