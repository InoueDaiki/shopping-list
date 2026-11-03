import { filterRegisteredItems, registeredItems, type Id, type RegisteredItem } from "@shopping-list/core";
import { Badge, Button, FullScreenMessage, Input, PageHeader, Text } from "@shopping-list/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { FlatList, View } from "react-native";

import { SwipeToDelete } from "../../../../components/SwipeToDelete.tsx";
import { UndoNotice } from "../../../../components/UndoNotice.tsx";
import { usePendingDelete } from "../../../../components/usePendingDelete.ts";
import { useRememberedHistory, useTable } from "../../../../data/hooks.ts";
import { repository } from "../../../../data/runtime.ts";
import { categoryToneMap } from "../../../../logic/categoryTone.ts";

const nameKey = (item: RegisteredItem) => item.normalizedName;

function shortDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

// リストの品目の管理。入力の候補とよく使う品目に出る、登録済みの品目名(買い物の履歴から作る)の一覧。
// 払うと忘れる(履歴は残し、売り場の順の学習には使い続ける)
export default function RegisteredItems() {
  const { listId } = useLocalSearchParams<{ listId: Id }>();
  const lists = useTable("lists");
  const categories = useTable("categories");
  const history = useRememberedHistory();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const forget = useCallback((item: RegisteredItem) => repository.forgetItemName(listId, item.name), [listId]);
  const { pending, hiddenKey, remove, undo } = usePendingDelete(forget, nameKey);
  const tones = useMemo(() => categoryToneMap(categories), [categories]);
  const names = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);

  const registered = useMemo(() => registeredItems({ listId, history }), [listId, history]);
  const shown = useMemo(
    () => filterRegisteredItems(registered, deferred).filter((item) => item.normalizedName !== hiddenKey),
    [registered, deferred, hiddenKey],
  );

  const renderItem = useCallback(
    ({ item }: { item: RegisteredItem }) => {
      const category = item.categoryId === null ? undefined : names.get(item.categoryId);
      return (
        <SwipeToDelete label={item.name} onDelete={() => remove(item)}>
          <View className="min-h-14 flex-row items-center gap-3 border-b border-border bg-surface px-4 py-2">
            <View className="min-w-0 flex-1">
              <Text>{item.name}</Text>
              <Text className="text-xs text-fg-muted">{`最後に買った日 ${shortDate(item.lastCheckedAt)}・${item.count}回`}</Text>
            </View>
            <Badge tone={(item.categoryId === null ? undefined : tones.get(item.categoryId)) ?? "neutral"}>{category ?? "未分類"}</Badge>
          </View>
        </SwipeToDelete>
      );
    },
    [names, tones, remove],
  );

  const list = lists.find((row) => row.id === listId);
  if (!list) {
    return <FullScreenMessage action={<Button onPress={() => router.back()}>戻る</Button>}>このリストは削除されました。</FullScreenMessage>;
  }

  return (
    <View className="flex-1 bg-canvas">
      <FlatList
        className="flex-1"
        data={shown}
        keyExtractor={nameKey}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pb-safe-or-6"
        ListHeaderComponent={
          <View className="px-4 pt-4 pb-3">
            <PageHeader
              title="品目の管理"
              description={`${list.name}の入力の候補とよく使う品目に出る名前です。払うと削除し、候補に出なくなります。また買えば、その分からまた出ます。`}
            />
            {registered.length > 0 && <Input accessibilityLabel="品目を探す" placeholder="品目を探す" value={query} onChangeText={setQuery} returnKeyType="search" />}
          </View>
        }
        ListEmptyComponent={
          <Text className="px-4 py-12 text-center text-fg-muted">
            {registered.length === 0 ? "登録された品目はありません。買い終えた品目がここに出ます。" : "合う品目がありません。"}
          </Text>
        }
      />
      {pending && (
        <View className="px-4 pb-safe-or-2">
          <UndoNotice message={`「${pending.name}」を削除しました`} onUndo={undo} />
        </View>
      )}
    </View>
  );
}
