import { describe, expect, it } from "vitest";
import { isLearnableTrip, kendallTau, learnCategoryOrder, masterOrder } from "./ordering.ts";
import { groupTrips, type CheckRecord, type Trip } from "./trips.ts";
import type { Category, Id, StoreOrder } from "./types.ts";

const STORE = "store-fictional";
const NOW = "2040-06-01T00:00:00.000Z";
const START = Date.parse("2028-01-01T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

// テストの結果を毎回同じにするための小さな乱数(mulberry32)
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const categoryIds = Array.from({ length: 16 }, (_, i) => `cat-${String(i).padStart(2, "0")}`);
const categories: Category[] = categoryIds.map((id, sort) => ({ id, name: id, sort }));

type TripKind = "forward" | "backward" | "detour" | "batch";

interface SimulationOptions {
  truth: readonly Id[];
  kinds: readonly TripKind[];
  random: () => number;
  // 1つのカテゴリで買う品目の数の上限
  maxItemsPerCategory?: number;
  firstDay?: number;
  // すべてのカテゴリを毎回買う。定番の売り場どうしの重みが最も重くなる場面
  everyCategory?: boolean;
}

function pickRoute(truth: readonly Id[], random: () => number): Id[] {
  const size = 5 + Math.floor(random() * (truth.length - 4));
  const picked = new Set(shuffled(truth, random).slice(0, size));
  return truth.filter((id) => picked.has(id));
}

function simulateTrip(
  kind: TripKind,
  options: SimulationOptions,
  day: number,
  tripNo: number,
): CheckRecord[] {
  const { truth, random } = options;
  const route = options.everyCategory ? [...truth] : pickRoute(truth, random);
  if (kind === "backward") route.reverse();
  if (kind === "detour") {
    // 1つのカテゴリだけ、別の場所で買う
    const [moved] = route.splice(Math.floor(random() * route.length), 1);
    route.splice(Math.floor(random() * (route.length + 1)), 0, moved);
  }
  if (kind === "batch") route.splice(0, route.length, ...shuffled(route, random));

  const checks: CheckRecord[] = [];
  let at = START + day * DAY;
  for (const categoryId of route) {
    const count = 1 + Math.floor(random() * (options.maxItemsPerCategory ?? 2));
    for (let i = 0; i < count; i++) {
      checks.push({
        id: `check-${tripNo}-${checks.length}`,
        storeId: STORE,
        categoryId,
        checkedAt: new Date(at).toISOString(),
      });
      at += kind === "batch" ? 1000 + random() * 1500 : i + 1 < count ? 4000 : 30_000 + random() * 90_000;
    }
  }
  return checks;
}

function simulate(options: SimulationOptions): Trip[] {
  const checks = options.kinds.flatMap((kind, i) =>
    simulateTrip(kind, options, (options.firstDay ?? 0) + i * 3, i),
  );
  return groupTrips(checks);
}

// 買い物の混ぜ方の割合から種類の列を作る。最初のトリップは順回りにそろえる
function mixedKinds(count: number, random: () => number, backwardShare: number): TripKind[] {
  return Array.from({ length: count }, (_, i): TripKind => {
    if (i === 0) return "forward";
    const roll = random();
    if (roll < backwardShare) return "backward";
    if (roll < backwardShare + 0.15) return "detour";
    if (roll < backwardShare + 0.25) return "batch";
    return "forward";
  });
}

function learn(trips: readonly Trip[], manualOrder: StoreOrder | null = null): Id[] {
  return learnCategoryOrder({ storeId: STORE, categories, trips, manualOrder, now: NOW });
}

function meanTau(
  run: (seed: number) => { truth: Id[]; order: Id[] },
  seeds = 20,
): number {
  let total = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const { truth, order } = run(seed);
    total += kendallTau(order, truth);
  }
  return total / seeds;
}

describe("kendallTau", () => {
  it("同じ順は 1、逆は -1、順番に無い要素は比べない", () => {
    expect(kendallTau(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(kendallTau(["c", "b", "a"], ["a", "b", "c"])).toBe(-1);
    expect(kendallTau(["a", "x", "b"], ["a", "b"])).toBe(1);
    expect(kendallTau(["a"], ["a", "b"])).toBe(0);
  });
});

describe("isLearnableTrip", () => {
  const trip = (stamps: [Id, number][]): Trip =>
    groupTrips(
      stamps.map(([categoryId, seconds], i) => ({
        id: `c${i}`,
        storeId: STORE,
        categoryId,
        checkedAt: new Date(START + seconds * 1000).toISOString(),
      })),
    )[0];

  it("カテゴリが3つ未満のトリップは使わない", () => {
    expect(isLearnableTrip(trip([["a", 0], ["b", 60]]))).toBe(false);
  });

  it("まとめてチェックしたトリップは使わない", () => {
    expect(isLearnableTrip(trip([["a", 0], ["b", 1], ["c", 2], ["d", 3]]))).toBe(false);
  });

  it("同じカテゴリを続けて買っても、売り場の移動に時間があれば使う", () => {
    const stamps: [Id, number][] = [
      ["a", 0], ["a", 1], ["a", 2],
      ["b", 60], ["b", 61], ["b", 62],
      ["c", 120], ["c", 121], ["c", 122],
    ];
    expect(isLearnableTrip(trip(stamps))).toBe(true);
  });

  it("同じカテゴリが並んでいても、全体がまとめてのチェックなら使わない", () => {
    const stamps: [Id, number][] = [
      ["a", 0], ["a", 2], ["a", 4],
      ["b", 6], ["b", 8], ["b", 10],
      ["c", 12], ["c", 14], ["c", 16],
    ];
    expect(isLearnableTrip(trip(stamps))).toBe(false);
  });
});

describe("learnCategoryOrder", () => {
  it("記録が無ければマスタの順を返す", () => {
    expect(learn([])).toEqual(masterOrder(categories));
  });

  it("同点はマスタの順で決める", () => {
    const random = seededRandom(1);
    const trips = simulate({
      truth: ["cat-03", "cat-02", "cat-01"],
      kinds: ["forward"],
      random,
    });
    const order = learn(trips);
    expect(order.filter((id) => ["cat-03", "cat-02", "cat-01"].includes(id))).toEqual([
      "cat-03",
      "cat-02",
      "cat-01",
    ]);
    const untouched = categoryIds.filter((id) => !["cat-03", "cat-02", "cat-01"].includes(id));
    expect(order.filter((id) => untouched.includes(id))).toEqual(untouched);
  });

  it("同じ入力なら入力の並びによらず同じ結果になる", () => {
    const random = seededRandom(5);
    const truth = shuffled(categoryIds, random);
    const trips = simulate({ truth, kinds: mixedKinds(30, random, 0.2), random });
    expect(learn(shuffled(trips, random))).toEqual(learn(trips));
  });

  it("ほかの店舗と終わっていないトリップは数えない", () => {
    const random = seededRandom(9);
    const truth = shuffled(categoryIds, random);
    const trips = simulate({ truth, kinds: ["forward"], random });
    const expectMaster = masterOrder(categories);
    expect(
      learnCategoryOrder({
        storeId: "store-other",
        categories,
        trips,
        manualOrder: null,
        now: NOW,
      }),
    ).toEqual(expectMaster);
    expect(
      learnCategoryOrder({
        storeId: STORE,
        categories,
        trips,
        manualOrder: null,
        now: trips[0].endedAt,
      }),
    ).toEqual(expectMaster);
  });

  it("順回り、逆回り、寄り道、まとめてのチェックが混ざっても正解に近づく", () => {
    const tauAfter = (count: number): number =>
      meanTau((seed) => {
        const random = seededRandom(seed);
        const truth = shuffled(categoryIds, random);
        const trips = simulate({ truth, kinds: mixedKinds(count, random, 0.25), random });
        return { truth, order: learn(trips) };
      });
    const [early, later] = [tauAfter(3), tauAfter(30)];
    expect(later).toBeGreaterThan(0.9);
    expect(later).toBeGreaterThan(early);
  });

  it("逆回りが混ざっても順回りだけの場合より悪くならない", () => {
    const run = (backwardShare: number): number =>
      meanTau((seed) => {
        const random = seededRandom(seed);
        const truth = shuffled(categoryIds, random);
        const trips = simulate({ truth, kinds: mixedKinds(30, random, backwardShare), random });
        return { truth, order: learn(trips) };
      });
    expect(run(0.5)).toBeGreaterThan(run(0) - 0.02);
  });

  it("最初のトリップが逆回りでも、順番としては正解の裏返しに収まる", () => {
    const tau = meanTau((seed) => {
      const random = seededRandom(seed);
      const truth = shuffled(categoryIds, random);
      const kinds: TripKind[] = ["backward", ...mixedKinds(20, random, 0.2)];
      const trips = simulate({ truth, kinds, random });
      return { truth, order: learn(trips) };
    });
    expect(tau).toBeLessThan(-0.85);
  });

  it("売り場が変わると新しい配置へ移る", () => {
    // 配置を半分ずらすと前の順番との τ がほぼ 0 になり、向きはどちらにも転ぶ。
    // どちらの向きでも昇順と降順で補えるので、絶対値で見る
    const tau = meanTau((seed) => {
      const random = seededRandom(seed);
      const before = shuffled(categoryIds, random);
      const after = [...before.slice(8), ...before.slice(0, 8)];
      const old = simulate({ truth: before, kinds: mixedKinds(30, random, 0.1), random });
      const fresh = simulate({
        truth: after,
        kinds: Array.from({ length: 15 }, () => "forward" as const),
        random,
        firstDay: 100,
      });
      const order = learn([...old, ...fresh]);
      return { truth: after, order: kendallTau(order, after) < 0 ? order.reverse() : order };
    });
    expect(tau).toBeGreaterThan(0.85);
  });

  describe("手の順番", () => {
    const edited = (categoryIdsInOrder: Id[], day: number): StoreOrder => ({
      storeId: STORE,
      categoryIds: categoryIdsInOrder,
      editedAt: new Date(START + day * DAY).toISOString(),
    });

    function setup(seed: number): { truth: Id[]; trips: Trip[]; random: () => number } {
      const random = seededRandom(seed);
      const truth = shuffled(categoryIds, random);
      const kinds = Array.from({ length: 40 }, () => "forward" as const);
      return { truth, trips: simulate({ truth, kinds, random, everyCategory: true }), random };
    }

    // 正解の2つのカテゴリを入れ替える。売り場の入れ替えを手で直した場面に当たる
    function swapped(truth: readonly Id[], a: number, b: number): Id[] {
      const order = [...truth];
      [order[a], order[b]] = [order[b], order[a]];
      return order;
    }

    function pairAgrees(order: readonly Id[], first: Id, second: Id): boolean {
      return order.indexOf(first) < order.indexOf(second);
    }

    it("手で直した直後は、履歴が多くてもそのまま返す", () => {
      const { truth, trips } = setup(3);
      const manual = swapped(truth, 2, 10);
      expect(learn(trips, edited(manual, 1000))).toEqual(manual);
    });

    it("学習に使えないトリップが終わっても手の順番のまま", () => {
      const { truth, trips } = setup(4);
      const manual = swapped(truth, 2, 10);
      const small = groupTrips(
        ["cat-00", "cat-01"].map((categoryId, i) => ({
          id: `small-${i}`,
          storeId: STORE,
          categoryId,
          checkedAt: new Date(START + 1001 * DAY + i * 60_000).toISOString(),
        })),
      );
      expect(learn([...trips, ...small], edited(manual, 1000))).toEqual(manual);
    });

    it("手の順番に無い新しいカテゴリは末尾に足し、消えたカテゴリは除く", () => {
      const order = learn([], edited(["cat-02", "cat-gone", "cat-01"], 1));
      expect(order.slice(0, 2)).toEqual(["cat-02", "cat-01"]);
      expect(order).toHaveLength(categoryIds.length);
      expect(order).not.toContain("cat-gone");
    });

    it("次のトリップが配置どおりなら、履歴の重い組でも修正は戻らない", () => {
      for (const seed of [3, 4, 5, 6, 7, 8]) {
        const { truth, trips, random } = setup(seed);
        // 新しい配置: 2 と 10 の売り場が入れ替わった
        const moved = swapped(truth, 2, 10);
        const after = simulate({
          truth: moved,
          kinds: ["forward"],
          random,
          firstDay: 1000,
          everyCategory: true,
        });
        const order = learn([...trips, ...after], edited(moved, 999));
        expect(pairAgrees(order, truth[10], truth[2])).toBe(true);
      }
    });

    it("手の順番に逆らうトリップが1回あっても、手の修正を優先する", () => {
      const { truth, trips, random } = setup(12);
      const after = simulate({
        truth,
        kinds: ["forward"],
        random,
        firstDay: 1000,
        everyCategory: true,
      });
      const moved = swapped(truth, 2, 3);
      const order = learn([...trips, ...after], edited(moved, 999));
      expect(pairAgrees(order, truth[3], truth[2])).toBe(true);
    });

    it("手の順番に逆らう買い物が続けば、やがて買い物のほうへ戻る", () => {
      const { truth, trips, random } = setup(11);
      const after = simulate({
        truth,
        kinds: Array.from({ length: 12 }, () => "forward" as const),
        random,
        firstDay: 1000,
        everyCategory: true,
      });
      const order = learn([...trips, ...after], edited(swapped(truth, 2, 10), 999));
      expect(pairAgrees(order, truth[2], truth[10])).toBe(true);
    });
  });

  it("カテゴリ30個、トリップ300回でも一瞬で終わる", () => {
    const manyIds = Array.from({ length: 30 }, (_, i) => `many-${String(i).padStart(2, "0")}`);
    const manyCategories = manyIds.map((id, sort) => ({ id, name: id, sort }));
    const random = seededRandom(2);
    const truth = shuffled(manyIds, random);
    const trips = simulate({ truth, kinds: mixedKinds(300, random, 0.2), random });
    const started = performance.now();
    const order = learnCategoryOrder({
      storeId: STORE,
      categories: manyCategories,
      trips,
      manualOrder: null,
      now: NOW,
    });
    expect(performance.now() - started).toBeLessThan(500);
    expect(kendallTau(order, truth)).toBeGreaterThan(0.9);
  });
});
