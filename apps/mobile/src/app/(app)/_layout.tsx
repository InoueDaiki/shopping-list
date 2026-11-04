// シートが決まった後のレイアウト。ここにいる間だけ同期を動かす
import { useTokenColor } from "@shopping-list/ui-native";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";

import { repository, syncRunner } from "../../data/runtime.ts";

// 外から別の画面を直に開いたとき(ウィジェットの品目の追加など)も、下に一覧を敷き、戻ると一覧に出る
export const unstable_settings = { initialRouteName: "index" };

export default function AppLayout() {
  const canvas = useTokenColor("canvas");
  const fg = useTokenColor("fg");

  useEffect(() => {
    repository.finishTrips();
    syncRunner.setShopping(repository.isShopping());
    syncRunner.start();
    const subscription = AppState.addEventListener("change", (state) => {
      syncRunner.setForeground(state === "active");
    });
    return () => {
      subscription.remove();
      syncRunner.stop();
    };
  }, []);

  return (
    <Stack
      screenOptions={{
        title: "",
        headerStyle: { backgroundColor: canvas },
        headerTintColor: fg,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: canvas },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* 下から出る面は画面の中で描く(ui-native の Sheet)ので、画面そのものは透明に重ねるだけ */}
      <Stack.Screen
        name="quick-add"
        options={{ presentation: "transparentModal", animation: "none", headerShown: false, contentStyle: { backgroundColor: "transparent" } }}
      />
    </Stack>
  );
}
