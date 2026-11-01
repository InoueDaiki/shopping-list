import type { ReactNode } from "react";
import { Pressable, type PressableProps } from "react-native";

import { cx } from "./cx.ts";
import { ForegroundProvider } from "./foreground.tsx";
import { wrapText } from "./Text.tsx";

export interface ChipProps extends Omit<PressableProps, "children" | "style"> {
  // 選んでいる状態にする(絞り込みに使うとき)。よく使う品目のように押すだけなら付けない
  selected?: boolean;
  className?: string;
  // 文字と、小さなアイコン(<Icon size={16}>)。文字列はそのまま書いてよい
  children: ReactNode;
}

// 丸い小さな操作。よく使う品目を押して追加するときなどに、横に並べる
export function Chip({ selected = false, disabled, className, children, ...props }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      hitSlop={4}
      className={cx(
        "h-10 flex-row items-center gap-1.5 rounded-full border px-4",
        selected
          ? "border-primary-fg bg-primary-soft active:bg-surface-strong"
          : "border-border-strong bg-surface active:bg-surface-strong",
        disabled && "opacity-50",
        className,
      )}
      {...props}
    >
      <ForegroundProvider
        value={{
          textClass: cx("text-sm font-medium", selected ? "text-primary-fg" : "text-fg"),
          color: selected ? "primary-fg" : "fg",
        }}
      >
        {wrapText(children)}
      </ForegroundProvider>
    </Pressable>
  );
}
