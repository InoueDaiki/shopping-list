import { Alert, Badge, Button, Card, ConfirmDialog, PageHeader, Text } from "@shopping-list/ui-native";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { signIn, useAuth } from "../../../auth.ts";
import { Page } from "../../../components/Page.tsx";
import { SheetSetupForm } from "../../../components/SheetSetupForm.tsx";
import { useLeaveSheetGuard } from "../../../components/useLeaveSheetGuard.ts";
import { config } from "../../../config.ts";
import { DESTINATION_LABELS, type Destination } from "../../../data/destination.ts";
import { useListDestinations, usePendingCount, useSheet, useSyncStatus } from "../../../data/hooks.ts";
import { signOutAndWipe } from "../../../data/runtime.ts";

// 保存先。リストごとに選ぶ保存先(アプリ内、スプレッドシート)の状態と、スプレッドシートの接続
export default function Storage() {
  const destinations = useListDestinations();
  const counts = useMemo(() => {
    const result: Record<Destination, number> = { local: 0, sheets: 0 };
    for (const dest of destinations.values()) result[dest] += 1;
    return result;
  }, [destinations]);

  return (
    <Page>
      <PageHeader title="保存先" description="リストごとに、どこに保存するかを選べます。" />
      <Card className="gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="font-bold">{DESTINATION_LABELS.local}</Text>
          <View>
            <Badge>{`リスト ${config.demo ? destinations.size : counts.local}`}</Badge>
          </View>
        </View>
        <Text className="text-sm text-fg-muted">この端末の中だけに保存します。ログインは要りません。ほかの人とは共有しません。</Text>
      </Card>
      {config.demo ? (
        <Alert>デモモードです。スプレッドシートにつながず、この端末の中だけで動いています。</Alert>
      ) : (
        <Sheets lists={counts.sheets} />
      )}
      <Card className="gap-1">
        <Text className="font-bold text-fg-muted">Notion</Text>
        <Text className="text-sm text-fg-muted">まだ対応していません。</Text>
      </Card>
    </Page>
  );
}

// スプレッドシートの接続。ログイン、シートを決める、切り替える、切り離す
function Sheets({ lists }: { lists: number }) {
  const auth = useAuth();
  const sheet = useSheet();
  const pending = usePendingCount();
  const { issues } = useSyncStatus();
  const leave = useLeaveSheetGuard();
  const [action, setAction] = useState<"switch" | "signOut">("switch");
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const signingIn = auth.status === "signingIn";
  const signedOut = auth.status === "signedOut";

  const switchSheet = () => {
    setAction("switch");
    void leave.guard(() => router.push("/settings/switch-sheet"));
  };
  const signOut = () => {
    setAction("signOut");
    void leave.guard(() => void signOutAndWipe());
  };

  const login = (
    <>
      {signedOut && auth.error && <Alert tone="danger">{auth.error}</Alert>}
      <Button variant="primary" disabled={signingIn} onPress={() => void signIn()}>
        {signingIn ? "ログインしています…" : "Google でログイン"}
      </Button>
    </>
  );

  if (sheet === null) {
    return (
      <>
        <Card className="gap-3">
          <Text className="font-bold">{DESTINATION_LABELS.sheets}</Text>
          <Text className="text-sm text-fg-muted">
            自分の Google スプレッドシートに保存します。シートを共有した相手と、同じリストを一緒に使えます。
          </Text>
          {auth.status === "signedIn" ? (
            <Text className="text-sm">{`${auth.user.email ?? "Google アカウント"} でログイン中`}</Text>
          ) : (
            auth.status !== "loading" && login
          )}
        </Card>
        {auth.status === "signedIn" && (
          <>
            <SheetSetupForm />
            <Button variant="ghost" onPress={() => void signOutAndWipe()}>
              ログアウト
            </Button>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <Card className="gap-3">
        <View className="flex-row items-center gap-2">
          <Text className="font-bold">{DESTINATION_LABELS.sheets}</Text>
          <View>
            <Badge>{`リスト ${lists}`}</Badge>
          </View>
        </View>
        <View className="gap-1">
          <Text className="text-sm font-medium text-fg-muted">アカウント</Text>
          <Text>
            {auth.status === "signedIn"
              ? (auth.user.email ?? "Google アカウント")
              : auth.status === "loading"
                ? "確かめています…"
                : "ログインしていません"}
          </Text>
        </View>
        <View className="gap-1">
          <Text className="text-sm font-medium text-fg-muted">シート</Text>
          <Text selectable className="text-sm">
            {sheet.spreadsheetUrl}
          </Text>
          <Text className="text-xs text-fg-muted">{pending > 0 ? `未送信 ${pending} 件` : "送信待ちはありません"}</Text>
        </View>
        {(signedOut || signingIn) && (
          <>
            <Alert tone="warning">ログインが切れています。ログインし直すと、スプレッドシートのリストの同期を再開します。</Alert>
            {login}
          </>
        )}
      </Card>
      {issues.length > 0 && (
        <Alert tone="warning">{`シートの ${issues.length} 行を読み取れませんでした(${issues[0]?.table}、${issues[0]?.row} 行目など)。`}</Alert>
      )}
      <Button onPress={() => router.push("/settings/invite")}>招待する</Button>
      <Button disabled={leave.busy} onPress={switchSheet}>
        別のシートに切り替える
      </Button>
      <Button variant="ghost" disabled={leave.busy} onPress={() => setConfirmingSignOut(true)}>
        ログアウト
      </Button>
      <ConfirmDialog
        open={confirmingSignOut}
        title="ログアウトしますか"
        description="スプレッドシートのリストはこの端末から消えます(シートには残り、ログインしてつなぎ直すと戻ります)。アプリ内のリストは残ります。"
        confirmLabel="ログアウト"
        onConfirm={() => {
          setConfirmingSignOut(false);
          signOut();
        }}
        onCancel={() => setConfirmingSignOut(false)}
      />
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
    </>
  );
}
