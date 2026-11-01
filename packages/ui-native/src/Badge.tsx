import type { ColorName } from "@shopping-list/design-tokens/native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { cx } from "./cx.ts";
import { ForegroundProvider } from "./foreground.tsx";
import { wrapText } from "./Text.tsx";

// カテゴリの札の色。どのカテゴリにどの色を当てるかは、アプリが決める
export const categoryTones = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6", "cat-7", "cat-8"] as const;
export type CategoryTone = (typeof categoryTones)[number];

// neutral: 件数や「未分類」などの添え書き。accent: 新しいものなどの印
export type BadgeTone = "neutral" | "primary" | "accent" | "success" | "danger" | CategoryTone;

// Uniwind はソースの文字列からクラスを拾うので、札の色も組み立てずに全部書く
const toneClasses: Record<BadgeTone, { box: string; text: string }> = {
  neutral: { box: "bg-surface-muted", text: "text-fg-muted" },
  primary: { box: "bg-primary-soft", text: "text-primary-fg" },
  accent: { box: "bg-accent-soft", text: "text-accent-fg" },
  success: { box: "bg-success-soft", text: "text-success-fg" },
  danger: { box: "bg-danger-soft", text: "text-danger-fg" },
  "cat-1": { box: "bg-cat-1", text: "text-cat-1-fg" },
  "cat-2": { box: "bg-cat-2", text: "text-cat-2-fg" },
  "cat-3": { box: "bg-cat-3", text: "text-cat-3-fg" },
  "cat-4": { box: "bg-cat-4", text: "text-cat-4-fg" },
  "cat-5": { box: "bg-cat-5", text: "text-cat-5-fg" },
  "cat-6": { box: "bg-cat-6", text: "text-cat-6-fg" },
  "cat-7": { box: "bg-cat-7", text: "text-cat-7-fg" },
  "cat-8": { box: "bg-cat-8", text: "text-cat-8-fg" },
};

// アイコンの色(クラスでは決められないので、トークンの名前で持つ)
const toneColors: Record<BadgeTone, ColorName> = {
  neutral: "fg-muted",
  primary: "primary-fg",
  accent: "accent-fg",
  success: "success-fg",
  danger: "danger-fg",
  "cat-1": "cat-1-fg",
  "cat-2": "cat-2-fg",
  "cat-3": "cat-3-fg",
  "cat-4": "cat-4-fg",
  "cat-5": "cat-5-fg",
  "cat-6": "cat-6-fg",
  "cat-7": "cat-7-fg",
  "cat-8": "cat-8-fg",
};

export interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  // 文字と、小さなアイコン(<Icon size={14}>)
  children: ReactNode;
}

// 短い札(カテゴリ、件数など)
export function Badge({ tone = "neutral", className, children }: BadgeProps) {
  const t = toneClasses[tone];
  return (
    <View className={cx("flex-row items-center gap-1 self-start rounded-sm px-2 py-0.5", t.box, className)}>
      <ForegroundProvider value={{ textClass: cx("text-xs font-medium", t.text), color: toneColors[tone] }}>
        {wrapText(children)}
      </ForegroundProvider>
    </View>
  );
}
