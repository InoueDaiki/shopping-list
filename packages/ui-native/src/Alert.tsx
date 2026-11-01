import type { ColorName } from "@shopping-list/design-tokens/native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { cx } from "./cx.ts";
import { ForegroundProvider } from "./foreground.tsx";
import { wrapText } from "./Text.tsx";

export type AlertTone = "info" | "success" | "warning" | "danger";

const toneClasses: Record<AlertTone, { box: string; text: string }> = {
  info: { box: "bg-primary-soft", text: "text-fg" },
  success: { box: "bg-success-soft", text: "text-success-fg" },
  warning: { box: "bg-accent-soft", text: "text-accent-fg" },
  danger: { box: "bg-danger-soft", text: "text-danger-fg" },
};

// アイコンの色(クラスでは決められないので、トークンの名前で持つ)
const toneColors: Record<AlertTone, ColorName> = {
  info: "fg",
  success: "success-fg",
  warning: "accent-fg",
  danger: "danger-fg",
};

export interface AlertProps {
  tone?: AlertTone;
  // 右に並べる操作(もう一度試す、など)
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

// 画面の中の知らせ。danger は読み上げですぐ伝える(accessibilityRole="alert")
export function Alert({ tone = "info", action, className, children }: AlertProps) {
  const t = toneClasses[tone];
  return (
    <View
      accessibilityRole={tone === "danger" ? "alert" : undefined}
      className={cx("flex-row flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-4 py-3", t.box, className)}
    >
      <View className="min-w-0 flex-1">
        <ForegroundProvider value={{ textClass: cx("text-sm", t.text), color: toneColors[tone] }}>{wrapText(children)}</ForegroundProvider>
      </View>
      {action}
    </View>
  );
}
