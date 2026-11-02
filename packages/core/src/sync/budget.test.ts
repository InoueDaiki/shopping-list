import { describe, expect, it } from "vitest";

import { RateBudget } from "./budget.ts";

describe("RateBudget", () => {
  const limits = { readsPerWindow: 3, writesPerWindow: 3, windowMs: 60_000 };

  it("reserve の分を残して止め、同期の分は最後まで使える", () => {
    const budget = new RateBudget(limits, () => 0);
    expect(budget.tryTake(1, 0, 1)).toBe(true);
    expect(budget.tryTake(1, 0, 1)).toBe(true);
    expect(budget.tryTake(1, 0, 1)).toBe(false);
    expect(budget.tryTake(1, 0)).toBe(true);
    // 読み取りの reserve は書き込みに掛からない
    expect(budget.tryTake(0, 3, 1)).toBe(false);
    expect(budget.tryTake(0, 2, 1)).toBe(true);
  });

  it("窓を過ぎた分は数えない", () => {
    let now = 0;
    const budget = new RateBudget(limits, () => now);
    expect(budget.tryTake(3, 0)).toBe(true);
    expect(budget.tryTake(1, 0)).toBe(false);
    now = 60_001;
    expect(budget.tryTake(1, 0)).toBe(true);
  });
});
