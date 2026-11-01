import { Alert, Button, Text } from "@shopping-list/ui-native";
import { View } from "react-native";

import { signIn, useAuth } from "../auth.ts";

// ログインの画面。押すと OS のブラウザで Google のログインを開く
export default function SignIn() {
  const auth = useAuth();
  const busy = auth.status === "signingIn";
  return (
    <View className="flex-1 items-center justify-center gap-6 bg-canvas p-6">
      <View className="items-center gap-2">
        <Text className="text-2xl font-bold">買い物リスト</Text>
        <Text className="text-center text-fg-muted">2人で使う買い物リストです。データは自分の Google スプレッドシートに置きます。</Text>
      </View>
      {auth.status === "signedOut" && auth.error && (
        <Alert tone="danger" className="w-full">
          {auth.error}
        </Alert>
      )}
      <Button variant="primary" size="lg" disabled={busy} onPress={() => void signIn()}>
        {busy ? "ログインしています…" : "Google でログイン"}
      </Button>
    </View>
  );
}
