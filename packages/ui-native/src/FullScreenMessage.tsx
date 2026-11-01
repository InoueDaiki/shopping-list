import type { ReactNode } from "react";
import { View } from "react-native";

import { wrapText } from "./Text.tsx";

// 画面全体の真ん中に出す知らせ(読み込み中、ログインの失敗、権限がない)
export function FullScreenMessage({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-canvas p-6">
      {wrapText(children, "text-center text-fg-muted")}
      {action}
    </View>
  );
}
