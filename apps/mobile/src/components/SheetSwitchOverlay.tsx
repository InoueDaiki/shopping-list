import { FullScreenMessage } from "@shopping-list/ui-native";
import { Modal } from "react-native";

import { useWritesLocked } from "../data/hooks.ts";

// シートの切り替えの通信の間、操作を止める。この間の書き込みは受け付けない
export function SheetSwitchOverlay() {
  const locked = useWritesLocked();
  return (
    <Modal visible={locked} animationType="fade" onRequestClose={() => undefined}>
      <FullScreenMessage>シートを確かめています。そのままお待ちください…</FullScreenMessage>
    </Modal>
  );
}
