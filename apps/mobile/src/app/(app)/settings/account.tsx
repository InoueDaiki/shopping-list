import { Alert, Button, Card, ConfirmDialog, PageHeader, Text } from "@shopping-list/ui-native";
import { router } from "expo-router";
import { useState } from "react";

import { useAuth } from "../../../auth.ts";
import { Page } from "../../../components/Page.tsx";
import { config } from "../../../config.ts";
import { usePendingCount, useSheet, useSyncStatus } from "../../../data/hooks.ts";
import { localStore, signOutAndWipe, syncRunner } from "../../../data/runtime.ts";

type Confirm = "switch" | "signOut" | null;

// アカウントとシート
export default function Account() {
  const auth = useAuth();
  const sheet = useSheet();
  const pending = usePendingCount();
  const { issues } = useSyncStatus();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  const proceed = (action: Exclude<Confirm, null>) => {
    if (action === "switch") router.push("/settings/switch-sheet");
    else void signOutAndWipe();
  };

  // 未送信があれば、まず送ってみる。それでも残れば確かめる(切り替えとログアウトでは端末から消える)
  const start = async (action: Exclude<Confirm, null>) => {
    if (localStore.pendingCountNow() > 0) {
      setBusy(true);
      await syncRunner.syncNow();
      setBusy(false);
    }
    if (localStore.pendingCountNow() > 0) setConfirm(action);
    else proceed(action);
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
      {issues.length > 0 && <Alert tone="warning">{`シートの ${issues.length} 行を読み取れませんでした(${issues[0]?.table}、${issues[0]?.row} 行目など)。`}</Alert>}
      <Button disabled={busy} onPress={() => void start("switch")}>
        別のシートに切り替える
      </Button>
      <Button variant="ghost" disabled={busy} onPress={() => void start("signOut")}>
        ログアウト
      </Button>
      <ConfirmDialog
        open={confirm !== null}
        tone="danger"
        title={`未送信の変更が ${pending} 件あります`}
        description={
          confirm === "switch"
            ? "シートを切り替えると、まだ送っていない変更はこの端末から消え、元に戻せません。"
            : "ログアウトすると、まだ送っていない変更はこの端末から消え、元に戻せません。"
        }
        confirmLabel={confirm === "switch" ? "消して切り替える" : "消してログアウト"}
        onConfirm={() => {
          if (confirm) proceed(confirm);
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </Page>
  );
}
