// いちばん外のレイアウト。ログインとシートの状態で、見せる画面を決める。
// シートが決まっていれば、ログインの確認を待たずに SQLite の中身を描く
import "../global.css";

import { useTokenColor } from "@shopping-list/ui-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaListener, SafeAreaProvider } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";

import { useAuth } from "../auth.ts";
import { AccountConfirmDialog } from "../components/AccountConfirmDialog.tsx";
import { SheetSwitchOverlay } from "../components/SheetSwitchOverlay.tsx";
import { config } from "../config.ts";
import { useAccountOwner, useHasPending, usePendingInvite, useSheet } from "../data/hooks.ts";
import { adoptAccount } from "../data/runtime.ts";
import { accountCheck } from "../logic/account.ts";

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
  const owner = useAccountOwner();
  const hasPending = useHasPending();
  const canvas = useTokenColor("canvas");
  const loading = auth.status === "loading";
  const email = auth.status === "signedIn" ? auth.user.email : undefined;
  const check =
    !config.demo && auth.status === "signedIn" ? accountCheck({ email, owner, hasLocalCopy: sheet !== null || hasPending }) : "ok";
  const blocked = check === "different" || check === "unknown";

  useEffect(() => {
    if (check === "adopt") adoptAccount(email);
  }, [check, email]);

  if (!config.demo && loading && !sheet) {
    return <View className="flex-1 bg-canvas" />;
  }
  const signedIn = (auth.status === "signedIn" && !blocked) || loading;
  // 招待の確認はログインの後に出す
  const join = !config.demo && auth.status === "signedIn" && !blocked && invite !== null;
  const app = !join && (config.demo || (signedIn && sheet !== null));
  const setup = !join && !config.demo && signedIn && sheet === null;
  return (
    <>
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
      {blocked && <AccountConfirmDialog different={check === "different"} email={email} />}
      <SheetSwitchOverlay />
    </>
  );
}
