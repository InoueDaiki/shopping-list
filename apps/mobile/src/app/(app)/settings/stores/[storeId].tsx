import type { Id } from "@shopping-list/core";
import { Button, ConfirmDialog, cx, Field, FullScreenMessage, Icon, Input, PageHeader, Text } from "@shopping-list/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowDown, ArrowUp } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { Page } from "../../../../components/Page.tsx";
import { useOrder, useTable } from "../../../../data/hooks.ts";
import { repository } from "../../../../data/runtime.ts";
import { moveInOrder } from "../../../../logic/moveInOrder.ts";

// 店舗の名前とカテゴリの順番の編集。手の順番は、次に学習に使えるトリップが終わるまでそのまま出る
export default function StoreDetail() {
  const { storeId } = useLocalSearchParams<{ storeId: Id }>();
  const stores = useTable("stores");
  const categories = useTable("categories");
  const store = stores.find((row) => row.id === storeId);
  const learned = useOrder(storeId);
  const [name, setName] = useState(store?.name ?? "");
  const [order, setOrder] = useState<readonly Id[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const names = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);
  const shown = order ?? learned;

  if (!store) {
    return <FullScreenMessage action={<Button onPress={() => router.back()}>戻る</Button>}>この店舗はもうありません。</FullScreenMessage>;
  }

  const save = () => {
    if (name.trim() !== store.name) repository.updateStore(store.id, { name: name.trim() });
    if (order) repository.saveStoreOrder(store.id, [...order]);
    router.back();
  };

  return (
    <Page>
      <PageHeader title="店舗を編集" />
      <Field label="店舗の名前">
        <Input value={name} onChangeText={setName} />
      </Field>
      <Text className="text-sm font-medium">カテゴリの順番</Text>
      <View className="overflow-hidden rounded-lg border border-border bg-surface">
        {shown.map((id, index) => (
          <View key={id} className={cx("min-h-12 flex-row items-center gap-1 pr-1 pl-4", index > 0 && "border-t border-border")}>
            <Text className="min-w-0 flex-1">{names.get(id) ?? id}</Text>
            <Button
              icon
              variant="ghost"
              disabled={index === 0}
              accessibilityLabel={`${names.get(id) ?? id}を上へ`}
              onPress={() => setOrder(moveInOrder(shown, index, -1))}
            >
              <Icon icon={ArrowUp} size={20} />
            </Button>
            <Button
              icon
              variant="ghost"
              disabled={index === shown.length - 1}
              accessibilityLabel={`${names.get(id) ?? id}を下へ`}
              onPress={() => setOrder(moveInOrder(shown, index, 1))}
            >
              <Icon icon={ArrowDown} size={20} />
            </Button>
          </View>
        ))}
      </View>
      <Button variant="primary" size="lg" disabled={name.trim() === ""} onPress={save}>
        保存する
      </Button>
      <Button variant="ghost" onPress={() => setDeleting(true)}>
        この店舗を削除
      </Button>
      <ConfirmDialog
        open={deleting}
        tone="danger"
        title={`「${store.name}」を削除しますか`}
        description="この店舗のカテゴリの順番も削除します。買い物の履歴は残ります。"
        confirmLabel="削除する"
        onConfirm={() => {
          setDeleting(false);
          repository.deleteStore(store.id);
          router.back();
        }}
        onCancel={() => setDeleting(false)}
      />
    </Page>
  );
}
