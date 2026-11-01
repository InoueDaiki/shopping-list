import { frequentItems, itemSuggestions, lookupCategory, type Id, type Item } from "@shopping-list/core";
import { Button, Chip, cx, Input, PageHeader, Text } from "@shopping-list/ui-native";
import { useLocalSearchParams } from "expo-router";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Pressable, type TextInput, View } from "react-native";

import { CategorySheet } from "../../../../components/CategorySheet.tsx";
import { Page } from "../../../../components/Page.tsx";
import { useListItems, useTable } from "../../../../data/hooks.ts";
import { localStore, repository } from "../../../../data/runtime.ts";

// 品目の追加。カテゴリは過去の品目から待たずに決め、分からなければその場で選べる
export default function AddItem() {
  const { listId } = useLocalSearchParams<{ listId: Id }>();
  const items = useListItems(listId);
  const history = useTable("history");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [uncategorized, setUncategorized] = useState<Item | null>(null);
  const input = useRef<TextInput>(null);
  const query = useDeferredValue(name);

  const now = useMemo(() => new Date().toISOString(), [history]);
  const suggestions = useMemo(() => itemSuggestions({ query, listId, history, items, now }), [query, listId, history, items, now]);
  const frequent = useMemo(() => frequentItems({ listId, history, items, now }), [listId, history, items, now]);

  const add = (itemName: string) => {
    const category = lookupCategory({
      name: itemName,
      listId,
      categories: localStore.rows("categories"),
      items: localStore.rows("items"),
      history,
    });
    const item = repository.addItem(listId, itemName, category);
    setName("");
    setNotice(item ? `「${item.name}」を追加しました` : itemName.trim() === "" ? null : "すでにリストにあります");
    if (item && item.categoryId === null) setUncategorized(item);
    else input.current?.focus();
  };

  return (
    <Page>
      <PageHeader title="品目を追加" />
      <View className="flex-row items-center gap-2">
        <Input
          ref={input}
          className="min-w-0 flex-1"
          autoFocus
          accessibilityLabel="品目の名前"
          placeholder="品目の名前"
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => add(name)}
          submitBehavior="submit"
          returnKeyType="done"
        />
        <Button variant="primary" size="lg" disabled={name.trim() === ""} onPress={() => add(name)}>
          追加
        </Button>
      </View>
      {notice !== null && <Text className="text-sm text-fg-muted">{notice}</Text>}

      {suggestions.length > 0 && (
        <View className="overflow-hidden rounded-lg border border-border bg-surface">
          {suggestions.map((suggestion, index) => (
            <Pressable
              key={suggestion.normalizedName}
              accessibilityRole="button"
              onPress={() => add(suggestion.name)}
              className={cx("min-h-12 flex-row items-center justify-between px-4 active:bg-surface-muted", index > 0 && "border-t border-border")}
            >
              <Text>{suggestion.name}</Text>
              {suggestion.origin === "otherList" && <Text className="text-xs text-fg-muted">ほかのリスト</Text>}
            </Pressable>
          ))}
        </View>
      )}

      {frequent.length > 0 && (
        <View className="gap-2">
          <Text className="text-sm font-medium text-fg-muted">よく使う品目</Text>
          <View className="flex-row flex-wrap gap-2">
            {frequent.map((item) => (
              <Chip key={item.normalizedName} onPress={() => add(item.name)}>
                {item.name}
              </Chip>
            ))}
          </View>
        </View>
      )}

      <CategorySheet
        itemName={uncategorized?.name ?? null}
        onClose={() => setUncategorized(null)}
        onSelect={(categoryId) => {
          if (uncategorized) repository.updateItem(uncategorized.id, { categoryId });
          setUncategorized(null);
        }}
      />
    </Page>
  );
}
