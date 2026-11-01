import { useState } from "react";

import { localStore, syncRunner } from "../data/runtime.ts";

// シートから離れる操作(切り替え、ログアウト)の前の確かめ。未送信があれば、まず送ってみて、
// それでも残れば確認を出す。離れると未送信は端末から消えるため
export function useLeaveSheetGuard() {
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<(() => void) | null>(null);

  const guard = async (proceed: () => void) => {
    if (localStore.pendingCountNow() > 0) {
      setBusy(true);
      await syncRunner.syncNow();
      setBusy(false);
    }
    if (localStore.pendingCountNow() > 0) setWaiting(() => proceed);
    else proceed();
  };

  return {
    busy,
    guard,
    confirming: waiting !== null,
    confirm: () => {
      waiting?.();
      setWaiting(null);
    },
    cancel: () => setWaiting(null),
  };
}
