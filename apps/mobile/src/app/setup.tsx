import { PageHeader } from "@shopping-list/ui-native";
import { ScrollView } from "react-native";

import { SheetSetupForm } from "../components/SheetSetupForm.tsx";

// 最初のシートの設定。決まると、いちばん外のレイアウトがリストの一覧へ移す
export default function Setup() {
  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="px-4 pt-safe-offset-6 pb-safe-or-6" keyboardShouldPersistTaps="handled">
      <PageHeader title="シートの設定" description="リストを置くスプレッドシートを決めます。" />
      <SheetSetupForm />
    </ScrollView>
  );
}
