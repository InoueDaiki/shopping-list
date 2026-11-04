import { Sheet } from "@shopping-list/ui-native";
import { router } from "expo-router";

// 品目の追加。ホーム画面のウィジェットとアプリのショートカットから shoppinglist://quick-add で開く
// (docs/設計メモ.md の「ホーム画面のウィジェット」)。中身は仮で、見出しと閉じるだけ。
// 画面は透明に重ね、下から出る面を描く。閉じると下の画面に戻る。
// ウィジェットとショートカットはタスクを作り直して開くので、下には一覧を敷いてある(./_layout.tsx の unstable_settings)
export default function QuickAdd() {
  return (
    <Sheet open title="品目を追加" onClose={close}>
      {null}
    </Sheet>
  );
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
