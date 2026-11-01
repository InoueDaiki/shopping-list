import { Alert } from "@shopping-list/ui-native";

import { usePendingCount, useSyncStatus } from "../data/hooks.ts";
import { syncNotice } from "../logic/syncNotice.ts";

// 同期の知らせ。問題が無いときは何も出さない
export function SyncNoticeBar({ className }: { className?: string }) {
  const notice = syncNotice(useSyncStatus(), usePendingCount());
  if (!notice) return null;
  return (
    <Alert tone={notice.tone} className={className}>
      {notice.text}
    </Alert>
  );
}
