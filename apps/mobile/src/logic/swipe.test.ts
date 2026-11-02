import { describe, expect, it } from "vitest";

import { isDeleteSwipe, isHorizontalSwipe } from "./swipe.ts";

describe("行を払って消す", () => {
  it("横に動いたときだけ払い始めとみなし、縦のスクロールは奪わない", () => {
    expect(isHorizontalSwipe(30, 5)).toBe(true);
    expect(isHorizontalSwipe(-30, 5)).toBe(true);
    expect(isHorizontalSwipe(30, 20)).toBe(false);
    expect(isHorizontalSwipe(8, 0)).toBe(false);
  });

  it("行の幅の3割を超えれば、どちらの向きでも消す", () => {
    expect(isDeleteSwipe(130, 0, 400)).toBe(true);
    expect(isDeleteSwipe(-130, 0, 400)).toBe(true);
    expect(isDeleteSwipe(110, 0, 400)).toBe(false);
  });

  it("速く払えば短くても消す。戻す向きの速さでは消さない", () => {
    expect(isDeleteSwipe(80, 1.2, 400)).toBe(true);
    expect(isDeleteSwipe(40, 1.2, 400)).toBe(false);
    expect(isDeleteSwipe(80, -1.2, 400)).toBe(false);
  });

  it("幅が分からないうちは消さない", () => {
    expect(isDeleteSwipe(500, 3, 0)).toBe(false);
  });
});
