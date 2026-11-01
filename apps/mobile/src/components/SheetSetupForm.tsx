import { Alert, Button, Card, Field, Input, Text } from "@shopping-list/ui-native";
import { useState } from "react";
import { View } from "react-native";

import { connectSheet, sheetsClient } from "../data/runtime.ts";
import { createSheet, openExistingSheet, sheetErrorMessage, type SheetRef } from "../data/spreadsheet.ts";

type Busy = "create" | "open" | null;

// シートを決める。新しく作るか、URL を貼って既存のものを開くかを同じ画面で選ぶ。
// spreadsheets のスコープでは Drive の一覧を取れないので、既存のものは URL を貼る
export function SheetSetupForm({ onDone }: { onDone?: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: Exclude<Busy, null>, task: () => Promise<SheetRef>, input = "") => {
    setBusy(kind);
    setError(null);
    try {
      await connectSheet(await task());
      onDone?.();
    } catch (e) {
      console.info("シートを開けなかった", e);
      setError(sheetErrorMessage(e, input));
      setBusy(null);
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
        <Button variant="primary" disabled={busy !== null} onPress={() => void run("create", () => createSheet(sheetsClient))}>
          {busy === "create" ? "作っています…" : "新しく作る"}
        </Button>
      </Card>
      <Card className="gap-3">
        <Text className="font-bold">すでにあるシートを使う</Text>
        <Field label="スプレッドシートの URL" hint="一緒に使う人が作ったシートの URL を貼ります">
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
          disabled={busy !== null || url.trim() === ""}
          onPress={() => void run("open", () => openExistingSheet(sheetsClient, url), url)}
        >
          {busy === "open" ? "確かめています…" : "開く"}
        </Button>
      </Card>
    </View>
  );
}
