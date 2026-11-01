import type { ReactNode } from "react";
import { View } from "react-native";

import { cx } from "./cx.ts";

export interface CardProps {
  // danger: 削除などの操作をまとめる面
  tone?: "default" | "danger";
  className?: string;
  children: ReactNode;
}

// 地の上に置く面。中身の余白は既定で p-4(className で変えられる)
export function Card({ tone = "default", className, children }: CardProps) {
  return (
    <View className={cx("rounded-lg border bg-surface p-4", tone === "danger" ? "border-danger" : "border-border", className)}>
      {children}
    </View>
  );
}
