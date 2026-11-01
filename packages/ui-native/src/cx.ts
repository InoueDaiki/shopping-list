import { twMerge } from "tailwind-merge";

// クラス名をつなぐ。偽の値は飛ばす。ぶつかるクラスは後ろのものを残す
// (React Native では文字の色や大きさを親から引き継がないので、部品が既定のクラスを付け、呼び出し側が上書きする)
export function cx(...parts: (string | false | null | undefined)[]): string {
  return twMerge(parts.filter(Boolean).join(" "));
}
