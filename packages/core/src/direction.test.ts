import { describe, expect, it } from "vitest";
import { setDirectionManually, startTripDirection, updateDirection } from "./direction.ts";

const order = ["a", "b", "c", "d", "e"];

describe("updateDirection", () => {
  it("2カテゴリまでは比べない", () => {
    const state = startTripDirection();
    expect(updateDirection(state, order, ["e", "d"])).toBe(state);
  });

  it("3カテゴリで τ が -0.5 以下なら降順にする", () => {
    expect(updateDirection(startTripDirection(), order, ["e", "c", "a"])).toEqual({
      direction: "desc",
      autoSwitched: true,
      manual: false,
    });
  });

  it("τ が -0.5 より大きければ切り替えない", () => {
    const state = startTripDirection();
    // τ = -1/3
    expect(updateDirection(state, order, ["c", "e", "a"])).toBe(state);
  });

  it("3カテゴリで切り替わらなくても、そのあとのチェックで切り替わる", () => {
    const state = startTripDirection();
    expect(updateDirection(state, order, ["c", "e", "a"]).direction).toBe("asc");
    expect(updateDirection(state, order, ["c", "e", "a", "b", "d"].reverse()).direction).toBe(
      "asc",
    );
    expect(updateDirection(state, order, ["c", "e", "b", "a"]).direction).toBe("desc");
  });

  it("切り替えはトリップの中で1回まで", () => {
    const switched = updateDirection(startTripDirection(), order, ["e", "c", "a"]);
    const back = { ...switched, direction: "asc" as const };
    expect(updateDirection(back, order, ["e", "d", "c", "a"])).toBe(back);
  });

  it("手で切り替えたトリップでは自動で切り替えない", () => {
    const state = setDirectionManually(startTripDirection(), "asc");
    expect(updateDirection(state, order, ["e", "c", "a"])).toBe(state);
  });

  it("順番に無いカテゴリは数えない", () => {
    const state = startTripDirection();
    expect(updateDirection(state, order, ["e", "x", "a"])).toBe(state);
  });
});

describe("setDirectionManually", () => {
  it("向きを変えて手の印を付ける", () => {
    expect(setDirectionManually(startTripDirection(), "desc")).toEqual({
      direction: "desc",
      autoSwitched: false,
      manual: true,
    });
  });
});
