import { Alert, Button, ConfirmDialog, PageHeader, Text } from "@shopping-list/ui-native";
import { useState } from "react";
import { View } from "react-native";

import { useLeaveSheetGuard } from "../components/useLeaveSheetGuard.ts";
import { usePendingCount, usePendingInvite, useSheet } from "../data/hooks.ts";
import { connectSheet, forgetInvite, sheetsClient } from "../data/runtime.ts";
import { openExistingSheet, sheetErrorMessage } from "../data/spreadsheet.ts";

// 招待リンクで開く確認。リンクは外から誰でも開かせられるので、必ず確かめてからシートを読みに行く。
// 招待が片付くと、いちばん外のレイアウトが元の画面へ戻す
export default function Join() {
  const invite = usePendingInvite();
  const sheet = useSheet();
  const pending = usePendingCount();
  const leave = useLeaveSheetGuard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const same = sheet?.spreadsheetId === invite;

  const open = async () => {
    if (invite === null) return;
    setBusy(true);
    setError(null);
    try {
      await connectSheet(await openExistingSheet(sheetsClient, invite));
    } catch (e) {
      setError(sheetErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 justify-center gap-4 bg-canvas p-6">
      <PageHeader title="招待されたシート" />
      {error !== null && <Alert tone="danger">{error}</Alert>}
      {same ? (
        <Text className="text-fg-muted">このシートはもう開いています。</Text>
      ) : (
        <>
          <Text className="text-fg-muted">
            {sheet
              ? "招待されたシートを開きますか。今のシートから切り替わります(今のシートはそのまま残ります)。"
              : "招待されたシートを開きますか。"}
          </Text>
          <Text className="text-sm text-fg-muted">開けないときは、シートの持ち主に編集者の権限を渡すよう頼んでください。</Text>
          <Button variant="primary" size="lg" disabled={busy || leave.busy} onPress={() => void leave.guard(() => void open())}>
            {busy ? "確かめています…" : "シートを開く"}
          </Button>
        </>
      )}
      <Button disabled={busy} onPress={forgetInvite}>
        {same ? "閉じる" : "やめる"}
      </Button>
      <ConfirmDialog
        open={leave.confirming}
        tone="danger"
        title={`未送信の変更が ${pending} 件あります`}
        description="シートを切り替えると、まだ送っていない変更はこの端末から消え、元に戻せません。"
        confirmLabel="消して切り替える"
        onConfirm={leave.confirm}
        onCancel={leave.cancel}
      />
    </View>
  );
}
