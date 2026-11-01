// シートが決まった後のレイアウト。ここにいる間だけ同期を動かす
import { useTokenColor } from "@shopping-list/ui-native";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";

import { repository, syncRunner } from "../../data/runtime.ts";

export default function AppLayout() {
  const canvas = useTokenColor("canvas");
  const fg = useTokenColor("fg");

  useEffect(() => {
    repository.finishTrips();
    syncRunner.setShopping(repository.currentSession() !== null);
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
    </Stack>
  );
}
