import type { Id, Item, ShoppingList } from "@shopping-list/core";
import { ActionSheet, Badge, Button, Icon, PageHeader, Text } from "@shopping-list/ui-native";
import { router } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { SwipeToDelete } from "../../components/SwipeToDelete.tsx";
import { UndoNotice } from "../../components/UndoNotice.tsx";
import { usePendingDelete } from "../../components/usePendingDelete.ts";
import { useStrayItems, useTable } from "../../data/hooks.ts";
import { repository } from "../../data/runtime.ts";
import { categoryToneMap } from "../../logic/categoryTone.ts";

const deleteItem = (item: Item) => repository.deleteItem(item.id);
const itemKey = (item: Item) => item.id;

interface Moved {
  name: string;
  list: ShoppingList;
}

// 未整理の品目(どのリストにも属さない野良品目)。押すとリストを選んで移し、払うと消す
export default function StrayItems() {
  const strays = useStrayItems();
  const lists = useTable("lists");
  const categories = useTable("categories");
  const { pending, hiddenKey, remove, undo } = usePendingDelete(deleteItem, itemKey);
  const [target, setTarget] = useState<Item | null>(null);
  const [moved, setMoved] = useState<Moved | null>(null);
  const tones = useMemo(() => categoryToneMap(categories), [categories]);
  const names = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);
  const shown = useMemo(() => strays.filter((item) => item.id !== hiddenKey), [strays, hiddenKey]);

  const moveTo = useCallback((item: Item, list: ShoppingList) => {
    if (repository.moveStrayItem(item.id, list.id)) setMoved({ name: item.name, list });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      const category = item.categoryId === null ? undefined : names.get(item.categoryId);
      return (
        <SwipeToDelete label={item.name} onDelete={() => remove(item)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}。リストへ移す`}
            onPress={() => setTarget(item)}
            className="min-h-14 flex-row items-center gap-3 border-b border-border bg-surface px-4 py-2 active:bg-surface-muted"
          >
            <Text className="min-w-0 flex-1">{item.name}</Text>
            <Badge tone={(item.categoryId === null ? undefined : tones.get(item.categoryId)) ?? "neutral"}>{category ?? "未分類"}</Badge>
            <Icon icon={ChevronRight} size={20} color="fg-muted" />
          </Pressable>
        </SwipeToDelete>
      );
    },
    [names, tones, remove],
  );

  const open = (listId: Id) => {
    setMoved(null);
    router.push(`/lists/${listId}`);
  };

  return (
    <View className="flex-1 bg-canvas">
      <FlatList
        className="flex-1"
        data={shown}
        keyExtractor={itemKey}
        renderItem={renderItem}
        contentContainerClassName="pb-safe-or-6"
        ListHeaderComponent={
          <View className="px-4 pt-4 pb-3">
            <PageHeader title="未整理" description="リストを決めずに追加した品目です。押すとリストへ移します。払うと削除します。" />
          </View>
        }
        ListEmptyComponent={<Text className="px-4 py-12 text-center text-fg-muted">未整理の品目はありません。</Text>}
      />
      {(pending || moved) && (
        <View className="gap-2 px-4 pb-safe-or-2">
          {moved && (
            <View
              accessibilityLiveRegion="polite"
              className="flex-row items-center gap-2 rounded-lg border border-border bg-surface-strong py-1 pr-2 pl-4"
            >
              <Text numberOfLines={1} className="min-w-0 flex-1 text-sm">
                {`「${moved.name}」を${moved.list.name}へ移しました`}
              </Text>
              <Button variant="link" onPress={() => open(moved.list.id)}>
                {`${moved.list.name}を開く`}
              </Button>
            </View>
          )}
          {pending && <UndoNotice message={`「${pending.name}」を削除しました`} onUndo={undo} />}
        </View>
      )}

      <ActionSheet
        open={target !== null}
        title={target ? `「${target.name}」を移すリスト` : ""}
        description={lists.length === 0 ? "リストがありません。リストの一覧の右上の + から追加してください。" : undefined}
        onCancel={() => setTarget(null)}
        items={lists.map((list) => ({ label: list.name, onPress: () => target && moveTo(target, list) }))}
      />
    </View>
  );
}
