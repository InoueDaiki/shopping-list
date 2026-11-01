import { ConfirmDialog } from "@shopping-list/ui-native";

import { signOut } from "../auth.ts";
import { usePendingCount } from "../data/hooks.ts";
import { replaceLocalCopy } from "../data/runtime.ts";

interface AccountConfirmDialogProps {
  // 別のアカウントと分かったら true。比べられないときは false
  different: boolean;
  email: string | undefined;
}

// 端末の写しが今のアカウントのものか分からないときの確認。メールは画面にも出さない
export function AccountConfirmDialog({ different, email }: AccountConfirmDialogProps) {
  const pending = usePendingCount();
  const lost = pending > 0 ? `まだ送っていない変更 ${pending} 件は消え、元に戻せません。` : "";
  return (
    <ConfirmDialog
      open
      tone="danger"
      title={different ? "別のアカウントのデータがあります" : "このデータの持ち主を確かめられません"}
      description={`続けるとこの端末のデータを消し、このアカウントで始めます。シートのデータは残ります。${lost}やめるとログアウトし、この端末のデータは残します。`}
      confirmLabel="消して続ける"
      cancelLabel="やめてログアウトする"
      onConfirm={() => void replaceLocalCopy(email)}
      onCancel={() => void signOut()}
    />
  );
}
