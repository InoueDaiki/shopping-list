import { Alert, Button, Card, Field, Input, Text } from "@shopping-list/ui-native";
import { useState } from "react";
import { View } from "react-native";

import { sheetDraftStore, sheetsClient, switchSheet } from "../data/runtime.ts";
import { createSheet, sheetErrorMessage } from "../data/spreadsheet.ts";
import { InitSheetDialog, useOpenSheet } from "./useOpenSheet.tsx";

// シートを決める。新しく作るか、URL を貼って既存のものを開くかを同じ画面で選ぶ。
// spreadsheets のスコープでは Drive の一覧を取れないので、既存のものは URL を貼る
export function SheetSetupForm({ onDone }: { onDone?: () => void }) {
  const [url, setUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const opener = useOpenSheet(onDone);
  const error = createError ?? opener.error;
  const busy = creating || opener.busy;

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await switchSheet(() => createSheet(sheetsClient, sheetDraftStore));
      onDone?.();
    } catch (e) {
      setCreateError(sheetErrorMessage(e));
      setCreating(false);
    }
  };

  return (
    <View className="gap-4">
      {error !== null && <Alert tone="danger">{error}</Alert>}
      <Card className="gap-3">
        <Text className="font-bold">新しいシートを作る</Text>
        <Text className="text-sm text-fg-muted">
          自分の Google ドライブにスプレッドシートを作ります。一緒に使う人には、Google スプレッドシートの画面から編集の権限を渡してください。
        </Text>
        <Button variant="primary" disabled={busy} onPress={() => void create()}>
          {creating ? "作っています…" : "新しく作る"}
        </Button>
      </Card>
      <Card className="gap-3">
        <Text className="font-bold">すでにあるシートを使う</Text>
        <Field label="スプレッドシートの URL" hint="一緒に使う人から届いたシートの URL か、招待リンクを貼ります">
          <Input
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
        </Field>
        <Button
          disabled={busy || url.trim() === ""}
          onPress={() => {
            setCreateError(null);
            void opener.open(url);
          }}
        >
          {opener.busy ? "確かめています…" : "開く"}
        </Button>
      </Card>
      <InitSheetDialog opener={opener} />
    </View>
  );
}
