import { Alert, Button, Card, ConfirmDialog, PageHeader, Text } from "@shopping-list/ui-native";
import { router } from "expo-router";
import { useState } from "react";

import { useAuth } from "../../../auth.ts";
import { Page } from "../../../components/Page.tsx";
import { useLeaveSheetGuard } from "../../../components/useLeaveSheetGuard.ts";
import { config } from "../../../config.ts";
import { usePendingCount, useSheet, useSyncStatus } from "../../../data/hooks.ts";
import { signOutAndWipe } from "../../../data/runtime.ts";

// アカウントとシート
export default function Account() {
  const auth = useAuth();
  const sheet = useSheet();
  const pending = usePendingCount();
  const { issues } = useSyncStatus();
  const leave = useLeaveSheetGuard();
  const [action, setAction] = useState<"switch" | "signOut">("switch");

  const switchSheet = () => {
    setAction("switch");
    void leave.guard(() => router.push("/settings/switch-sheet"));
  };
  const signOut = () => {
    setAction("signOut");
    void leave.guard(() => void signOutAndWipe());
  };

  if (config.demo) {
    return (
      <Page>
        <PageHeader title="アカウント" />
        <Alert>デモモードです。シートにつながず、この端末の中だけで動いています。</Alert>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="アカウント" />
      <Card className="gap-1">
        <Text className="text-sm font-medium text-fg-muted">ログイン中</Text>
        <Text>{auth.status === "signedIn" ? (auth.user.email ?? "Google アカウント") : "確かめています…"}</Text>
      </Card>
      <Card className="gap-1">
        <Text className="text-sm font-medium text-fg-muted">スプレッドシート</Text>
        <Text selectable className="text-sm">
          {sheet?.spreadsheetUrl ?? ""}
        </Text>
        <Text className="text-xs text-fg-muted">{pending > 0 ? `未送信 ${pending} 件` : "送信待ちはありません"}</Text>
      </Card>
      {issues.length > 0 && (
        <Alert tone="warning">{`シートの ${issues.length} 行を読み取れませんでした(${issues[0]?.table}、${issues[0]?.row} 行目など)。`}</Alert>
      )}
      <Button onPress={() => router.push("/settings/invite")}>招待する</Button>
      <Button disabled={leave.busy} onPress={switchSheet}>
        別のシートに切り替える
      </Button>
      <Button variant="ghost" disabled={leave.busy} onPress={signOut}>
        ログアウト
      </Button>
      <ConfirmDialog
        open={leave.confirming}
        tone="danger"
        title={`未送信の変更が ${pending} 件あります`}
        description={
          action === "switch"
            ? "シートを切り替えると、まだ送っていない変更はこの端末から消え、元に戻せません。"
            : "ログアウトすると、まだ送っていない変更はこの端末から消え、元に戻せません。"
        }
        confirmLabel={action === "switch" ? "消して切り替える" : "消してログアウト"}
        onConfirm={leave.confirm}
        onCancel={leave.cancel}
      />
    </Page>
  );
}
