import { describe, expect, it } from "vitest";
import { TRIP_GAP_MS } from "./constants.ts";
import { itemFixture } from "./test-support.ts";
import {
  checksFromItems,
  groupTrips,
  historyEntriesFromTrip,
  isTripFinished,
  medianCategoryGapMs,
  tripCategorySequence,
  tripIdOf,
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

describe("historyEntriesFromTrip", () => {
  const at = (offsetMs: number) => new Date(START + offsetMs).toISOString();
  const checked = (id: string, offsetMs: number, overrides = {}) =>
    itemFixture({
      id,
      name: `品目-${id}`,
      categoryId: "cat-a",
      categorySource: "user",
      checked: true,
      checkedAt: at(offsetMs),
      checkedStoreId: "store-a",
      ...overrides,
    });

  it("チェックの順に履歴の行を作り、品目の内容を写す", () => {
    const items = [checked("b", 1000), checked("a", 0, { categorySource: "inferred" })];
    const [trip] = groupTrips(checksFromItems(items));
    expect(historyEntriesFromTrip(trip, items)).toEqual([
      {
        id: "a",
        listId: "list-a",
        name: "品目-a",
        categoryId: "cat-a",
        categorySource: "inferred",
        storeId: "store-a",
        tripId: "a",
        checkedAt: at(0),
        checkedSeq: 0,
      },
      {
        id: "b",
        listId: "list-a",
        name: "品目-b",
        categoryId: "cat-a",
        categorySource: "user",
        storeId: "store-a",
        tripId: "a",
        checkedAt: at(1000),
        checkedSeq: 1,
      },
    ]);
  });

  it("並びの違う2台でも同じ行になり、履歴から組み直しても同じトリップになる", () => {
    const items = [checked("a", 0), checked("b", 1000), checked("c", TRIP_GAP_MS * 2)];
    const entriesOf = (order: typeof items) =>
      groupTrips(checksFromItems(order)).flatMap((trip) => historyEntriesFromTrip(trip, order));

    const entries = entriesOf(items);
    expect(entriesOf([...items].reverse())).toEqual(entries);
    expect(entries.map(({ tripId }) => tripId)).toEqual(["a", "a", "c"]);
    expect(groupTrips(entries).map(tripIdOf)).toEqual(["a", "c"]);
  });

  it("品目の無いチェックは除く", () => {
    const [trip] = groupTrips([check("gone", 0)]);
    expect(historyEntriesFromTrip(trip, [])).toEqual([]);
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
      // リストの無い品目はチェックできない。シートを手で直して入っても履歴へ移さない
      itemFixture({ id: "stray", listId: null, checked: true, checkedAt: at, checkedStoreId: "store-a" }),
    ]);
    expect(checks).toEqual([
      { id: "on", storeId: "store-a", categoryId: "cat-a", checkedAt: at },
    ]);
  });
});
