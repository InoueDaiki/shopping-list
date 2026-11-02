import { describe, expect, it } from "vitest";
import { NEAREST_STORE_MAX_M } from "./constants.ts";
import { haversineDistanceM, nearestStore, storeCandidates, storeLastUsed, storesForList } from "./stores.ts";
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

  it("距離の分かる店舗を近い順に上へ出し、位置の無い店舗は後ろに置く", () => {
    expect(ids(ORIGIN)).toEqual(["nearer", "near", "far", "no-place"]);
  });

  it("300m を超えても、最近使った店舗より距離を優先する", () => {
    const farther = storeFixture({ id: "farther", lat: metersNorth(5000), lng: 0 });
    const recent = new Map([["farther", "2028-07-01T00:00:00.000Z"]]);
    const result = storeCandidates({ stores: [farther, far], position: ORIGIN, lastUsed: recent });
    expect(result.map(({ store }) => store.id)).toEqual(["far", "farther"]);
  });

  it("位置の無い店舗どうしは最近使った順にする", () => {
    const old = storeFixture({ id: "old" });
    const result = storeCandidates({ stores: [old, noPlace, near], position: ORIGIN, lastUsed });
    expect(result.map(({ store }) => store.id)).toEqual(["near", "no-place", "old"]);
  });

  it("位置が無ければ最近使った順で、使っていない店舗は後ろに置く", () => {
    expect(ids(null)).toEqual(["no-place", "far", "near", "nearer"]);
  });

  it("距離と近さの印を付ける", () => {
    const [first, , third] = storeCandidates({ stores, position: ORIGIN, lastUsed });
    expect(first.nearby).toBe(true);
    expect(first.distanceM).toBeCloseTo(50, 0);
    expect(third).toMatchObject({ nearby: false });
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

describe("storesForList", () => {
  it("そのリストの店舗と、リストの決まっていない店舗だけを返す", () => {
    const stores = [
      storeFixture({ id: "mine", listId: "list-a" }),
      storeFixture({ id: "other", listId: "list-b" }),
      storeFixture({ id: "unassigned", listId: null }),
    ];
    expect(storesForList(stores, "list-a").map((store) => store.id)).toEqual(["mine", "unassigned"]);
  });
});

describe("nearestStore", () => {
  const at = (id: string, meters: number, listId: string | null = "list-a") =>
    storeFixture({ id, lat: metersNorth(meters), lng: 0, listId });

  it("リストをまたいで最も近い店舗を返す", () => {
    const result = nearestStore([at("far", 1000, "list-a"), at("near", 100, "list-b")], ORIGIN);
    expect(result?.store.id).toBe("near");
    expect(result?.distanceM).toBeCloseTo(100, 0);
  });

  it("リストの決まっていない店舗と、位置の無い店舗を除く", () => {
    const noPlace = storeFixture({ id: "no-place", listId: "list-a" });
    expect(nearestStore([at("unassigned", 100, null), noPlace, at("kept", 500)], ORIGIN)?.store.id).toBe("kept");
  });

  it("上限より遠ければ返さない", () => {
    expect(nearestStore([at("just", NEAREST_STORE_MAX_M - 1)], ORIGIN)?.store.id).toBe("just");
    expect(nearestStore([at("beyond", NEAREST_STORE_MAX_M + 1)], ORIGIN)).toBeNull();
  });

  it("今の位置が無ければ返さない", () => {
    expect(nearestStore([at("near", 100)], null)).toBeNull();
  });

  it("同じ距離なら ID の順で決める", () => {
    expect(nearestStore([at("b", 100), at("a", 100)], ORIGIN)?.store.id).toBe("a");
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
