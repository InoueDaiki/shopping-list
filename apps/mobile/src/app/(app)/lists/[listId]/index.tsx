import type { Id, Item } from "@shopping-list/core";
import { Badge, Button, cx, FullScreenMessage, Icon, Text } from "@shopping-list/ui-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ArrowDownNarrowWide, ArrowUpNarrowWide, ChevronRight, MapPin, Plus } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { ItemRow } from "../../../../components/ItemRow.tsx";
import { MemoSheet } from "../../../../components/MemoSheet.tsx";
import { StoreSheet } from "../../../../components/StoreSheet.tsx";
import { SyncNoticeBar } from "../../../../components/SyncNoticeBar.tsx";
import { useSections, useShopping, useTable } from "../../../../data/hooks.ts";
import { repository } from "../../../../data/runtime.ts";
import { categoryToneMap } from "../../../../logic/categoryTone.ts";
import { listRows, type ListRow } from "../../../../logic/listRows.ts";

// 品目の一覧。今の店舗の順に、カテゴリごとに並べる
export default function ListScreen() {
  const { listId } = useLocalSearchParams<{ listId: Id }>();
  const lists = useTable("lists");
  const categories = useTable("categories");
  const stores = useTable("stores");
  const session = useShopping();
  const storeId = session?.storeId ?? null;
  const direction = session?.direction.direction ?? "asc";
  const sections = useSections(listId, storeId, direction);
  const rows = useMemo(() => listRows(sections), [sections]);
  const tones = useMemo(() => categoryToneMap(categories), [categories]);
  const names = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);
  const [memoItem, setMemoItem] = useState<Item | null>(null);
  const [storeOpen, setStoreOpen] = useState(false);

  const onToggle = useCallback((id: Id, checked: boolean) => {
    if (!checked) {
      repository.uncheckItem(id);
    } else if (repository.checkItem(id)) {
      setStoreOpen(true);
    }
  }, []);
  const onEdit = useCallback((id: Id) => router.push(`/lists/${listId}/items/${id}`), [listId]);

  const renderItem = useCallback(
    ({ item: row }: { item: ListRow }) => {
      if (row.kind === "item") {
        return <ItemRow item={row.item} onToggle={onToggle} onMemo={setMemoItem} onEdit={onEdit} />;
      }
      if (row.kind === "checkedHeader") {
        return <Text className="px-4 pt-6 pb-1 text-sm font-medium text-fg-muted">{`チェック済み ${row.count}`}</Text>;
      }
      const name = row.categoryId === null ? "未分類" : (names.get(row.categoryId) ?? "未分類");
      const tone = row.categoryId === null ? undefined : tones.get(row.categoryId);
      return (
        <View className="flex-row items-center gap-2 px-4 pt-3 pb-1">
          <Badge tone={tone ?? "neutral"}>{name}</Badge>
        </View>
      );
    },
    [names, tones, onToggle, onEdit],
  );

  const list = lists.find((row) => row.id === listId);
  if (!list) {
    return <FullScreenMessage action={<Button onPress={() => router.back()}>戻る</Button>}>このリストは削除されました。</FullScreenMessage>;
  }
  const store = stores.find((row) => row.id === storeId);
  const descending = direction === "desc";

  return (
    <View className="flex-1 bg-canvas">
      <Stack.Screen
        options={{
          title: list.name,
          headerRight: () => (
            <Button
              icon
              variant="ghost"
              accessibilityLabel={descending ? "降順。昇順に切り替える" : "昇順。降順に切り替える"}
              onPress={() => repository.setDirection(descending ? "asc" : "desc")}
            >
              <Icon icon={descending ? ArrowUpNarrowWide : ArrowDownNarrowWide} size={22} />
            </Button>
          ),
        }}
      />
      <FlatList
        className="flex-1"
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderItem}
        initialNumToRender={24}
        contentContainerClassName="pb-4"
        ListHeaderComponent={<SyncNoticeBar className="mx-4 mt-2" />}
        ListEmptyComponent={<Text className="py-12 text-center text-fg-muted">品目がありません。下のボタンから追加してください。</Text>}
      />
      <View className="gap-2 border-t border-border bg-surface px-4 pt-2 pb-safe-or-3">
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={store ? `今の店舗は${store.name}。店舗を変える` : "店舗を選ぶ"}
            onPress={() => setStoreOpen(true)}
            className={cx("h-12 min-w-0 flex-1 flex-row items-center gap-2 rounded-full bg-surface-muted px-4 active:bg-surface-strong")}
          >
            <Icon icon={MapPin} size={18} color="fg-muted" />
            <Text numberOfLines={1} className="min-w-0 flex-1 text-sm">
              {store?.name ?? "店舗を選んでいません"}
            </Text>
            <Icon icon={ChevronRight} size={18} color="fg-muted" />
          </Pressable>
          <Button variant="primary" size="lg" onPress={() => router.push(`/lists/${listId}/add`)}>
            <Icon icon={Plus} size={20} />
            追加
          </Button>
        </View>
      </View>

      <MemoSheet
        item={memoItem}
        onClose={() => setMemoItem(null)}
        onEdit={(item) => {
          setMemoItem(null);
          onEdit(item.id);
        }}
      />
      <StoreSheet open={storeOpen} onClose={() => setStoreOpen(false)} />
    </View>
  );
}
