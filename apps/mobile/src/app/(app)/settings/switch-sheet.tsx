import { PageHeader } from "@shopping-list/ui-native";
import { router } from "expo-router";

import { Page } from "../../../components/Page.tsx";
import { SheetSetupForm } from "../../../components/SheetSetupForm.tsx";

// 別のシートへの切り替え。開けたときだけ、端末の写しを入れ替える
export default function SwitchSheet() {
  return (
    <Page>
      <PageHeader title="シートを切り替える" description="今のシートはそのまま残ります。" />
      <SheetSetupForm
        onDone={() => {
          router.dismissAll();
        }}
      />
    </Page>
  );
}
