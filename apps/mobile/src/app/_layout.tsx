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
import { usePendingInvite, useSheet } from "../data/hooks.ts";

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
  const invite = usePendingInvite();
  const canvas = useTokenColor("canvas");
  const loading = auth.status === "loading";
  if (!config.demo && loading && !sheet) {
    return <View className="flex-1 bg-canvas" />;
  }
  const signedIn = auth.status === "signedIn" || loading;
  // 招待の確認はログインの後に出す
  const join = !config.demo && auth.status === "signedIn" && invite !== null;
  const app = !join && (config.demo || (signedIn && sheet !== null));
  const setup = !join && !config.demo && signedIn && sheet === null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: canvas } }}>
      <Stack.Protected guard={app}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={setup}>
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={join}>
        <Stack.Screen name="join" />
      </Stack.Protected>
      <Stack.Protected guard={!app && !setup && !join}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
