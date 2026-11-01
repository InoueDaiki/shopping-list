import type { ColorName } from "@shopping-list/design-tokens/native";
import type { ReactNode } from "react";
import { Pressable, type PressableProps } from "react-native";

import { cx } from "./cx.ts";
import { ForegroundProvider } from "./foreground.tsx";
import { wrapText } from "./Text.tsx";

// primary: 画面の主な操作(1画面に1つ)。secondary: それ以外の操作。
// ghost: ヘッダーなどの目立たせない操作。danger: 削除など取り返しのつかない操作。
// link: 文の中や行の端に置く、文字だけの操作
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, { box: string; text: string }> = {
  primary: {
    box: "rounded-full bg-primary active:bg-primary-pressed",
    text: "font-bold text-on-primary",
  },
  secondary: {
    box: "rounded-full border border-border-strong bg-surface active:bg-surface-strong",
    text: "font-medium text-fg",
  },
  ghost: { box: "rounded-full active:bg-surface-strong", text: "font-medium text-fg" },
  danger: { box: "rounded-full bg-danger active:opacity-90", text: "font-bold text-on-danger" },
  link: { box: "rounded-sm active:opacity-60", text: "text-fg underline" },
};

// アイコンの色(クラスでは決められないので、トークンの名前で持つ)
const variantColors: Record<ButtonVariant, ColorName> = {
  primary: "on-primary",
  secondary: "fg",
  ghost: "fg",
  danger: "on-danger",
  link: "fg",
};

const sizeClasses: Record<ButtonSize, { box: string; text: string }> = {
  sm: { box: "h-9 px-3.5", text: "text-sm" },
  md: { box: "h-11 px-5", text: "text-sm" },
  lg: { box: "h-12 px-6", text: "text-base" },
};

// アイコンだけのボタンは、高さと同じ幅の正方形にする
const iconSizeClasses: Record<ButtonSize, string> = {
  sm: "size-9",
  md: "size-11",
  lg: "size-12",
};

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // アイコンだけのボタン(丸)。名前は accessibilityLabel で付ける
  icon?: boolean;
  className?: string;
  // 文字の大きさや色を変えるとき(link を小さくする、など)
  textClassName?: string;
  // 文字とアイコン(<Icon>)。文字列はそのまま書いてよい
  children?: ReactNode;
}

// 操作のボタン。押す処理は onPress
export function Button({
  variant = "secondary",
  size = "md",
  icon = false,
  className,
  textClassName,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const v = variantClasses[variant];
  const s = sizeClasses[size];
  const textClass = cx(s.text, v.text, textClassName);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      // link は文字の大きさしかないので、指で押せる広さを足す
      hitSlop={variant === "link" ? 12 : undefined}
      className={cx(
        "flex-row items-center justify-center gap-2",
        v.box,
        // link は高さと余白を持たない(文字の大きさを周りに合わせる)
        variant !== "link" && (icon ? iconSizeClasses[size] : s.box),
        disabled && "opacity-50",
        className,
      )}
      {...props}
    >
      <ForegroundProvider value={{ textClass, color: variantColors[variant] }}>{wrapText(children)}</ForegroundProvider>
    </Pressable>
  );
}
