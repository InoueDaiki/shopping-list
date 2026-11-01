import type { ReactNode } from "react";
import { ScrollView } from "react-native";

// リスト画面以外の、本文の枠
export function Page({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 px-4 pt-4 pb-safe-or-6"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
