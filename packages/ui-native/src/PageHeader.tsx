import type { ReactNode } from "react";
import { View } from "react-native";

import { Text, wrapText } from "./Text.tsx";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  // 右に並べる操作
  actions?: ReactNode;
}

// 画面の題。各画面の最初に置く。戻る操作は画面の上の帯(ナビゲーションのヘッダー)が持つ
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <View className="mb-6 gap-1">
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Text accessibilityRole="header" className="text-2xl leading-tight font-bold">
          {title}
        </Text>
        {actions && <View className="flex-row flex-wrap items-center gap-2">{actions}</View>}
      </View>
      {description && wrapText(description, "text-sm text-fg-muted")}
    </View>
  );
}
