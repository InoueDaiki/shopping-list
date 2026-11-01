import {
  MANUAL_DECAY_RATIO,
  MANUAL_ORDER_WEIGHT,
  MIN_MEDIAN_CHECK_GAP_MS,
  MIN_TRIP_CATEGORIES,
  ORDER_EPSILON,
  ORDER_MAX_PASSES,
  TRIP_DECAY,
  WEAK_DIRECTION_TAU,
  WEAK_DIRECTION_WEIGHT,
} from "./constants.ts";
import { isTripFinished, medianCategoryGapMs, tripCategorySequence, type Trip } from "./trips.ts";
import type { Category, Id, Iso, StoreOrder } from "./types.ts";

export interface LearnOrderInput {
  storeId: Id;
  categories: readonly Category[];
  // ほかの店舗のトリップと、終わっていないトリップは無視する
  trips: readonly Trip[];
  manualOrder: StoreOrder | null;
  now: Iso;
}

// マスタの順。計算の同点はこの順で決める
export function masterOrder(categories: readonly Category[]): Id[] {
  return [...categories]
    .sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((category) => category.id);
}

// sequence と order の Kendall の τ。order に無い要素は比べない。比べる組が無ければ 0
export function kendallTau(sequence: readonly Id[], order: readonly Id[]): number {
  const position = new Map(order.map((id, index) => [id, index]));
  const ranks = sequence.flatMap((id) => position.get(id) ?? []);
  const pairs = (ranks.length * (ranks.length - 1)) / 2;
  if (pairs === 0) return 0;
  let balance = 0;
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i + 1; j < ranks.length; j++) {
      balance += ranks[i] < ranks[j] ? 1 : -1;
    }
  }
  return balance / pairs;
}

// カテゴリの数とチェックの間隔を見て、学習に使えるトリップか判定する
export function isLearnableTrip(trip: Trip): boolean {
  if (tripCategorySequence(trip).length < MIN_TRIP_CATEGORIES) return false;
  const gap = medianCategoryGapMs(trip);
  return gap !== null && gap >= MIN_MEDIAN_CHECK_GAP_MS;
}

// 店舗の順番を学んだか。学習に使える終わったトリップも手の順番も無ければ、
// learnCategoryOrder の結果はマスタの順で、売り場の向きとは関係がない
export function hasLearnedOrder(
  input: Pick<LearnOrderInput, "storeId" | "trips" | "manualOrder" | "now">,
): boolean {
  if (input.manualOrder?.storeId === input.storeId) return true;
  return input.trips.some(
    (trip) =>
      trip.storeId === input.storeId && isTripFinished(trip, input.now) && isLearnableTrip(trip),
  );
}

// 手の順番をマスタに合わせる。消えたカテゴリを除き、新しいカテゴリを末尾に足す
function alignManualOrder(manual: readonly Id[], master: readonly Id[]): Id[] {
  const known = new Set(master);
  const aligned = new Set(manual.filter((id) => known.has(id)));
  for (const id of master) aligned.add(id);
  return [...aligned];
}

// weights[a * n + b] は「a が b より先」の重み。添字はマスタの順なので、同点は小さい添字が先
function addPairs(
  weights: Float64Array,
  n: number,
  sequence: readonly number[],
  weight: number,
): void {
  for (let i = 0; i < sequence.length; i++) {
    for (let j = i + 1; j < sequence.length; j++) {
      weights[sequence[i] * n + sequence[j]] += weight;
    }
  }
}

function copelandOrder(weights: Float64Array, n: number): number[] {
  const scores = new Array<number>(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const margin = weights[a * n + b] - weights[b * n + a];
      if (Math.abs(margin) <= ORDER_EPSILON) continue;
      scores[a] += Math.sign(margin);
      scores[b] -= Math.sign(margin);
    }
  }
  return Array.from({ length: n }, (_, index) => index).sort(
    (a, b) => scores[b] - scores[a] || a - b,
  );
}

// 位置 from の要素を動かして、重みに逆らう量が最も減る位置を探す。隣との入れ替えは
// 1つ分の挿入に当たる。減らなければ from を返す
function bestInsertion(
  perm: readonly number[],
  weights: Float64Array,
  n: number,
  from: number,
): number {
  const item = perm[from];
  let bestGain = ORDER_EPSILON;
  let bestTo = from;
  let gain = 0;
  for (let to = from - 1; to >= 0; to--) {
    gain += weights[item * n + perm[to]] - weights[perm[to] * n + item];
    if (gain > bestGain) [bestGain, bestTo] = [gain, to];
  }
  gain = 0;
  for (let to = from + 1; to < perm.length; to++) {
    gain += weights[perm[to] * n + item] - weights[item * n + perm[to]];
    if (gain > bestGain) [bestGain, bestTo] = [gain, to];
  }
  return bestTo;
}

// Copeland のスコアで並べてから、局所改善で重みに逆らう量を減らす
function solveOrder(weights: Float64Array, n: number): number[] {
  const perm = copelandOrder(weights, n);
  for (let pass = 0; pass < ORDER_MAX_PASSES; pass++) {
    let improved = false;
    for (let from = 0; from < n; from++) {
      const to = bestInsertion(perm, weights, n, from);
      if (to === from) continue;
      perm.splice(to, 0, ...perm.splice(from, 1));
      improved = true;
    }
    if (!improved) break;
  }
  return perm;
}

// 店舗のカテゴリの順番を計算する。同じ入力なら、どの端末でも同じ結果になる。
// 手の順番は、その後に学習できるトリップが終わるまでそのまま返す
export function learnCategoryOrder(input: LearnOrderInput): Id[] {
  const master = masterOrder(input.categories);
  const n = master.length;
  const indexOf = new Map(master.map((id, index) => [id, index]));
  const toIndexes = (ids: readonly Id[]): number[] => ids.map((id) => indexOf.get(id) as number);
  const manualOrder = input.manualOrder?.storeId === input.storeId ? input.manualOrder : null;
  const manual = manualOrder ? alignManualOrder(manualOrder.categoryIds, master) : null;
  const editedAt = manualOrder ? Date.parse(manualOrder.editedAt) : 0;

  const trips = input.trips
    .filter(
      (trip) =>
        trip.storeId === input.storeId && isTripFinished(trip, input.now) && isLearnableTrip(trip),
    )
    .map((trip) => ({
      startedAt: Date.parse(trip.startedAt),
      endedAt: Date.parse(trip.endedAt),
      firstId: trip.checks[0].id,
      sequence: tripCategorySequence(trip).filter((id) => indexOf.has(id)),
    }))
    .filter((trip) => trip.sequence.length >= MIN_TRIP_CATEGORIES)
    .sort(
      (a, b) =>
        a.startedAt - b.startedAt || (a.firstId < b.firstId ? -1 : a.firstId > b.firstId ? 1 : 0),
    );

  const tripWeights = new Float64Array(n * n);
  const manualPairs = new Float64Array(n * n);
  const combined = new Float64Array(n * n);
  if (manual) addPairs(manualPairs, n, toIndexes(manual), 1);

  let order = master;
  // 学んだ順番も手の順番も無い間は、比べる相手が無いのでトリップの向きをそのまま使う
  let hasReference = false;
  let manualApplied = false;
  let tripsSinceEdit = 0;

  for (const trip of trips) {
    if (manual && !manualApplied && trip.endedAt > editedAt) {
      manualApplied = true;
      order = manual;
      hasReference = true;
    }

    const tau = hasReference ? kendallTau(trip.sequence, order) : 1;
    const oriented = tau < 0 ? [...trip.sequence].reverse() : trip.sequence;
    const weight = Math.abs(tau) < WEAK_DIRECTION_TAU ? WEAK_DIRECTION_WEIGHT : 1;

    for (let i = 0; i < tripWeights.length; i++) tripWeights[i] *= TRIP_DECAY;
    addPairs(tripWeights, n, toIndexes(oriented), weight);

    if (manualApplied) tripsSinceEdit++;
    const manualWeight = manualApplied
      ? MANUAL_ORDER_WEIGHT * TRIP_DECAY ** (tripsSinceEdit * MANUAL_DECAY_RATIO)
      : 0;
    for (let i = 0; i < combined.length; i++) {
      combined[i] = tripWeights[i] + manualWeight * manualPairs[i];
    }
    order = solveOrder(combined, n).map((index) => master[index]);
    hasReference = true;
  }

  return manual && !manualApplied ? manual : order;
}
