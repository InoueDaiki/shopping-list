import { DIRECTION_FLIP_TAU, DIRECTION_MIN_CATEGORIES } from "./constants.ts";
import { kendallTau } from "./ordering.ts";
import type { Id } from "./types.ts";

export type ListDirection = "asc" | "desc";

// トリップの間だけ呼び出し側が持つ状態
export interface TripDirection {
  direction: ListDirection;
  // このトリップで自動で切り替えたか
  autoSwitched: boolean;
  // このトリップで手で切り替えたか
  manual: boolean;
}

export function startTripDirection(direction: ListDirection = "asc"): TripDirection {
  return { direction, autoSwitched: false, manual: false };
}

// 手で向きを切り替える。そのトリップでは自動で切り替えなくなる
export function setDirectionManually(
  state: TripDirection,
  direction: ListDirection,
): TripDirection {
  return { ...state, direction, manual: true };
}

// チェックのたびに呼ぶ。visited はトリップの中のカテゴリの順列、order は学んだ順番。
// 3カテゴリに届いてから比べ続け、切り替えるのはトリップの中で1回まで
export function updateDirection(
  state: TripDirection,
  order: readonly Id[],
  visited: readonly Id[],
): TripDirection {
  if (state.manual || state.autoSwitched || state.direction === "desc") return state;
  const known = new Set(order);
  const sequence = visited.filter((id) => known.has(id));
  if (sequence.length < DIRECTION_MIN_CATEGORIES) return state;
  if (kendallTau(sequence, order) > DIRECTION_FLIP_TAU) return state;
  return { ...state, direction: "desc", autoSwitched: true };
}
