// いちばん外のレイアウト。ふだんはログインを待たずに、SQLite の中身で一覧を描く(アプリ内のリストは
// ログインが要らない。スプレッドシートは設定の「保存先」からつなぐ)。招待リンクから開いたときだけ、
// ログインと確認の画面を先に出す
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
import { entryScreen } from "../logic/entry.ts";

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
  const email = auth.status === "signedIn" ? auth.user.email : undefined;
  const check =
    !config.demo && auth.status === "signedIn" ? accountCheck({ email, owner, hasLocalCopy: sheet !== null || hasPending }) : "ok";
  const blocked = check === "different" || check === "unknown";

  useEffect(() => {
    if (check === "adopt") adoptAccount(email);
  }, [check, email]);

  const entry = entryScreen({ demo: config.demo, invited: invite !== null, auth: auth.status, blocked });
  if (entry === "wait") {
    return <View className="flex-1 bg-canvas" />;
  }
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: canvas } }}>
        <Stack.Protected guard={entry === "app"}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={entry === "join"}>
          <Stack.Screen name="join" />
        </Stack.Protected>
        <Stack.Protected guard={entry === "signIn"}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
      {blocked && <AccountConfirmDialog different={check === "different"} email={email} />}
      <SheetSwitchOverlay />
    </>
  );
}
