import { describe, expect, it } from "vitest";
import { haversineDistanceM, storeCandidates, storeLastUsed } from "./stores.ts";
import { storeFixture } from "./test-support.ts";

// 緯度1度はおよそ 111.2km。位置はどこでもない海の上の架空の点
const ORIGIN = { lat: 0, lng: 0 };
const metersNorth = (meters: number): number => meters / 111_195;

describe("haversineDistanceM", () => {
  it("同じ点は 0", () => {
    expect(haversineDistanceM(ORIGIN, ORIGIN)).toBe(0);
  });

  it("緯度1度と赤道の経度1度はおよそ 111.2km", () => {
    expect(haversineDistanceM(ORIGIN, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
    expect(haversineDistanceM(ORIGIN, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -2);
  });
});

describe("storeCandidates", () => {
  const near = storeFixture({ id: "near", lat: metersNorth(100), lng: 0 });
  const nearer = storeFixture({ id: "nearer", lat: metersNorth(50), lng: 0 });
  const far = storeFixture({ id: "far", lat: metersNorth(1000), lng: 0 });
  const noPlace = storeFixture({ id: "no-place" });
  const lastUsed = new Map([
    ["far", "2028-05-01T00:00:00.000Z"],
    ["no-place", "2028-06-01T00:00:00.000Z"],
    ["near", "2028-04-01T00:00:00.000Z"],
  ]);
  const stores = [near, far, noPlace, nearer];
  const ids = (position: typeof ORIGIN | null): string[] =>
    storeCandidates({ stores, position, lastUsed }).map(({ store }) => store.id);

  it("300m 以内を距離の順に上へ出し、残りは最近使った順にする", () => {
    expect(ids(ORIGIN)).toEqual(["nearer", "near", "no-place", "far"]);
  });

  it("位置が無ければ最近使った順で、使っていない店舗は後ろに置く", () => {
    expect(ids(null)).toEqual(["no-place", "far", "near", "nearer"]);
  });

  it("距離と近さの印を付ける", () => {
    const [first, , , last] = storeCandidates({ stores, position: ORIGIN, lastUsed });
    expect(first.nearby).toBe(true);
    expect(first.distanceM).toBeCloseTo(50, 0);
    expect(last).toMatchObject({ nearby: false });
    const withoutPlace = storeCandidates({ stores: [noPlace], position: ORIGIN, lastUsed });
    expect(withoutPlace[0]).toMatchObject({ distanceM: null, nearby: false });
  });

  it("使っていない店舗は新しく登録した順に置く", () => {
    const older = storeFixture({ id: "older", createdAt: "2028-01-01T00:00:00.000Z" });
    const newer = storeFixture({ id: "newer", createdAt: "2028-02-01T00:00:00.000Z" });
    const result = storeCandidates({
      stores: [older, newer],
      position: null,
      lastUsed: new Map(),
    });
    expect(result.map(({ store }) => store.id)).toEqual(["newer", "older"]);
  });
});

describe("storeLastUsed", () => {
  it("店舗ごとの最後の日時を返し、店舗の無いチェックを除く", () => {
    const check = (storeId: string | null, checkedAt: string) => ({
      id: `${storeId}-${checkedAt}`,
      storeId,
      categoryId: null,
      checkedAt,
    });
    const used = storeLastUsed([
      check("a", "2028-02-01T00:00:00.000Z"),
      check("a", "2028-01-01T00:00:00.000Z"),
      check(null, "2028-03-01T00:00:00.000Z"),
    ]);
    expect([...used]).toEqual([["a", "2028-02-01T00:00:00.000Z"]]);
  });
});
