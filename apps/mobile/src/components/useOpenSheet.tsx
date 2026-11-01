import { ConfirmDialog } from "@shopping-list/ui-native";
import { useState } from "react";

import { sheetsClient, switchSheet } from "../data/runtime.ts";
import { initSheet, openExistingSheet, sheetErrorMessage, type SheetRef } from "../data/spreadsheet.ts";

// 既存のシートを開く流れ。アプリの形でなければ、書く前に確認を出す
export function useOpenSheet(onDone?: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsInit, setNeedsInit] = useState<{ spreadsheetId: string; input: string } | null>(null);

  const run = async (task: () => Promise<SheetRef | null>, input: string) => {
    setBusy(true);
    setError(null);
    try {
      if (await switchSheet(task)) {
        onDone?.();
        return;
      }
    } catch (e) {
      setError(sheetErrorMessage(e, input));
    }
    setBusy(false);
  };

  return {
    busy,
    error,
    needsInit: needsInit !== null,
    open: (input: string) =>
      run(async () => {
        const opened = await openExistingSheet(sheetsClient, input);
        if (opened.kind === "ready") return opened.sheet;
        setNeedsInit({ spreadsheetId: opened.spreadsheetId, input });
        return null;
      }, input),
    confirmInit: () => {
      if (needsInit === null) return;
      const { spreadsheetId, input } = needsInit;
      setNeedsInit(null);
      void run(() => initSheet(sheetsClient, spreadsheetId), input);
    },
    cancelInit: () => setNeedsInit(null),
  };
}

export function InitSheetDialog({ opener }: { opener: ReturnType<typeof useOpenSheet> }) {
  return (
    <ConfirmDialog
      open={opener.needsInit}
      title="このシートをアプリ用に初期化しますか"
      description="買い物リストのアプリの形ではありません。今あるシートには触らず、足りないシートを足して使います。"
      confirmLabel="シートを足して使う"
      onConfirm={opener.confirmInit}
      onCancel={opener.cancelInit}
    />
  );
}
