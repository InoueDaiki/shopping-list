// 学習と候補の数値。実際の買い物で調整するので、ここ1か所に置く。

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// トリップ: 同じ店舗で、前のチェックからこの時間以内なら1回の買い物とする
export const TRIP_GAP_MS = 3 * HOUR_MS;
// 店舗の替え方: 最後のチェックからこの時間以内は選び間違いの訂正として付け替え、
// 過ぎていれば別の店舗へ移ったとみなす(2軒回りで前の店舗の学習を汚さない)
export const STORE_CORRECTION_MS = 5 * 60 * 1000;

// 順番の学習: カテゴリがこれ未満のトリップは使わない
export const MIN_TRIP_CATEGORIES = 3;
// 順番の学習: カテゴリが変わるときの間隔の中央値がこれ未満なら、まとめてチェックしたとみなす
export const MIN_MEDIAN_CHECK_GAP_MS = 3 * 1000;
// 順番の学習: |τ| がこれ未満なら向きが分からないとみなす
export const WEAK_DIRECTION_TAU = 0.2;
// 順番の学習: 向きが分からないトリップの重み
export const WEAK_DIRECTION_WEIGHT = 0.5;
// 順番の学習: トリップ1回ごとの減衰
export const TRIP_DECAY = 0.9;
// 順番の学習: 手の順番をトリップ何回分の重みの観測として足すか。減衰 0.9 のトリップの
// 重みは合計で 10 に近づくので、それを超える値にする。5 だと毎回買う売り場の修正は
// 次のトリップで元に戻った
export const MANUAL_ORDER_WEIGHT = 12;
// 順番の学習: 手の順番の減衰の速さ(トリップに対する比)
export const MANUAL_DECAY_RATIO = 1 / 3;
// 順番の学習: 局所改善の周回の上限
export const ORDER_MAX_PASSES = 50;
// 順番の学習: 重みの比較で同点とみなす差
export const ORDER_EPSILON = 1e-9;

// 昇順と降順: 比較を始めるカテゴリの数
export const DIRECTION_MIN_CATEGORIES = 3;
// 昇順と降順: τ がこれ以下なら降順にする
export const DIRECTION_FLIP_TAU = -0.5;

// よく使う品目: 新しさの重みが半分になる日数
export const FREQUENT_HALF_LIFE_DAYS = 30;
// よく使う品目の表示の数
export const FREQUENT_LIMIT = 20;
// 入力中の候補の数
export const SUGGESTION_LIMIT = 8;

// 店舗: 近いとみなす距離
export const NEARBY_STORE_RADIUS_M = 300;
// 地球の平均半径
export const EARTH_RADIUS_M = 6_371_008.8;
