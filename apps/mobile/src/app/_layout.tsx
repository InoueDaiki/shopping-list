// いちばん外のレイアウト。ログインとシートの状態で、見せる画面を決める。
// シートが決まっていれば、ログインの確認を待たずに SQLite の中身を描く
import "../global.css";

import { useTokenColor } from "@shopping-list/ui-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaListener, SafeAreaProvider } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";

import { useAuth } from "../auth.ts";
import { config } from "../config.ts";
import { useSheet } from "../data/hooks.ts";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* 安全な領域を、pb-safe などのクラスで使えるようにする */}
      <SafeAreaListener style={{ flex: 1 }} onChange={({ insets }) => Uniwind.updateInsets(insets)}>
        <StatusBar style="auto" />
        <Root />
      </SafeAreaListener>
    </SafeAreaProvider>
  );
}

function Root() {
  const auth = useAuth();
  const sheet = useSheet();
  const canvas = useTokenColor("canvas");
  const loading = auth.status === "loading";
  if (!config.demo && loading && !sheet) {
    return <View className="flex-1 bg-canvas" />;
  }
  const signedIn = auth.status === "signedIn" || loading;
  const app = config.demo || (signedIn && sheet !== null);
  const setup = !config.demo && signedIn && sheet === null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: canvas } }}>
      <Stack.Protected guard={app}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={setup}>
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={!app && !setup}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
