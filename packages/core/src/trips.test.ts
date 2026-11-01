import { describe, expect, it } from "vitest";
import { TRIP_GAP_MS } from "./constants.ts";
import { itemFixture } from "./test-support.ts";
import {
  checksFromItems,
  groupTrips,
  isTripFinished,
  medianCategoryGapMs,
  tripCategorySequence,
  type CheckRecord,
} from "./trips.ts";

const START = Date.parse("2028-03-01T10:00:00.000Z");

function check(id: string, offsetMs: number, overrides: Partial<CheckRecord> = {}): CheckRecord {
  return {
    id,
    storeId: "store-a",
    categoryId: "cat-a",
    checkedAt: new Date(START + offsetMs).toISOString(),
    ...overrides,
  };
}

describe("groupTrips", () => {
  it("同じ店舗で3時間以内のチェックをまとめる", () => {
    const trips = groupTrips([
      check("a", 0),
      check("b", TRIP_GAP_MS),
      check("c", TRIP_GAP_MS * 2 + 1),
    ]);
    expect(trips.map((trip) => trip.checks.map(({ id }) => id))).toEqual([["a", "b"], ["c"]]);
    expect(trips[0].endedAt).toBe(check("b", TRIP_GAP_MS).checkedAt);
  });

  it("3時間はトリップの始まりからではなく前のチェックから数える", () => {
    const trips = groupTrips([
      check("a", 0),
      check("b", TRIP_GAP_MS - 1),
      check("c", TRIP_GAP_MS * 2 - 2),
    ]);
    expect(trips).toHaveLength(1);
  });

  it("別の店舗のチェックが間に入っても混ざらない", () => {
    const trips = groupTrips([
      check("a", 0),
      check("b", 1000, { storeId: "store-b" }),
      check("c", 2000),
    ]);
    expect(trips.map((trip) => [trip.storeId, trip.checks.length])).toEqual([
      ["store-a", 2],
      ["store-b", 1],
    ]);
  });

  it("店舗の無いチェックは除く", () => {
    expect(groupTrips([check("a", 0, { storeId: null })])).toEqual([]);
  });

  it("同じ時刻は checkedSeq、次に ID の順で並べる", () => {
    const trips = groupTrips([
      check("b", 0, { checkedSeq: 1 }),
      check("c", 0, { checkedSeq: 0 }),
      check("a", 0, { checkedSeq: 1 }),
    ]);
    expect(trips[0].checks.map(({ id }) => id)).toEqual(["c", "a", "b"]);
  });
});

describe("tripCategorySequence", () => {
  it("カテゴリごとの最初のチェックの順に並べ、未分類を除く", () => {
    const [trip] = groupTrips([
      check("a", 0, { categoryId: "cat-b" }),
      check("b", 10, { categoryId: null }),
      check("c", 20, { categoryId: "cat-a" }),
      check("d", 30, { categoryId: "cat-b" }),
    ]);
    expect(tripCategorySequence(trip)).toEqual(["cat-b", "cat-a"]);
  });
});

describe("medianCategoryGapMs", () => {
  it("カテゴリが変わるところの間隔の中央値を返す", () => {
    const [trip] = groupTrips([
      check("a", 0, { categoryId: "cat-a" }),
      check("b", 500, { categoryId: "cat-a" }),
      check("c", 1500, { categoryId: "cat-b" }),
      check("d", 4500, { categoryId: "cat-c" }),
      check("e", 9500, { categoryId: "cat-d" }),
    ]);
    expect(medianCategoryGapMs(trip)).toBe(3000);
  });

  it("偶数個なら真ん中の2つの平均を返し、変わるところが無ければ null", () => {
    const [even] = groupTrips([
      check("a", 0, { categoryId: "cat-a" }),
      check("b", 1000, { categoryId: "cat-b" }),
      check("c", 4000, { categoryId: "cat-c" }),
    ]);
    expect(medianCategoryGapMs(even)).toBe(2000);
    const [single] = groupTrips([check("a", 0), check("b", 1000)]);
    expect(medianCategoryGapMs(single)).toBeNull();
  });
});

describe("isTripFinished", () => {
  it("最後のチェックから3時間を過ぎると終わる", () => {
    const [trip] = groupTrips([check("a", 0)]);
    expect(isTripFinished(trip, new Date(START + TRIP_GAP_MS).toISOString())).toBe(false);
    expect(isTripFinished(trip, new Date(START + TRIP_GAP_MS + 1).toISOString())).toBe(true);
  });
});

describe("checksFromItems", () => {
  it("チェックされた品目だけを写す", () => {
    const at = "2028-03-01T10:00:00.000Z";
    const checks = checksFromItems([
      itemFixture({
        id: "on",
        categoryId: "cat-a",
        checked: true,
        checkedAt: at,
        checkedStoreId: "store-a",
      }),
      itemFixture({ id: "off", checked: false, checkedAt: at }),
    ]);
    expect(checks).toEqual([
      { id: "on", storeId: "store-a", categoryId: "cat-a", checkedAt: at },
    ]);
  });
});
