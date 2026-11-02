import { cx, Icon, PageHeader, Text } from "@shopping-list/ui-native";
import { router } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { Pressable, View } from "react-native";

import { Page } from "../../../../components/Page.tsx";
import { useTable } from "../../../../data/hooks.ts";

// 店舗の一覧。店舗はリストの画面の下の帯から登録する
export default function Stores() {
  const stores = useTable("stores");
  const lists = useTable("lists");
  return (
    <Page>
      <PageHeader title="店舗" description="押すと名前、リスト、位置、カテゴリの順番を直せます。" />
      {stores.length === 0 ? (
        <Text className="py-8 text-center text-fg-muted">店舗がありません。買い物の最初のチェックで登録できます。</Text>
      ) : (
        <View className="overflow-hidden rounded-lg border border-border bg-surface">
          {stores.map((store, index) => (
            <Pressable
              key={store.id}
              accessibilityRole="button"
              onPress={() => router.push(`/settings/stores/${store.id}`)}
              className={cx("min-h-14 flex-row items-center justify-between px-4 active:bg-surface-muted", index > 0 && "border-t border-border")}
            >
              <View className="min-w-0 flex-1">
                <Text>{store.name}</Text>
                <Text className="text-xs text-fg-muted">{lists.find((list) => list.id === store.listId)?.name ?? "リスト未設定"}</Text>
              </View>
              <Icon icon={ChevronRight} size={20} color="fg-muted" />
            </Pressable>
          ))}
        </View>
      )}
    </Page>
  );
}
