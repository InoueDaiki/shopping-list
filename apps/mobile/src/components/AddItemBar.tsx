import { frequentItems, itemSuggestions, lookupCategory, type Id } from "@shopping-list/core";
import { Button, Chip, cx, Input, Text } from "@shopping-list/ui-native";
import { type ComponentRef, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, type TextInput, View } from "react-native";

import { useListItems, useTable } from "../data/hooks.ts";
import { localStore, repository } from "../data/runtime.ts";
import { openItemNamed } from "../logic/listRows.ts";

// 候補の行数の上限。キーボードと合わせて、リストを隠し切らない高さに抑える
const SUGGESTION_ROWS = 3;

interface AddSuggestionsProps {
  listId: Id;
  query: string;
  onSelect: (name: string) => void;
}

// 入力が空ならよく使う品目、入力があれば候補。フォーカス中だけ置くので、
// 買い物中のチェックでは履歴を購読せず、計算もしない
function AddSuggestions({ listId, query, onSelect }: AddSuggestionsProps) {
  const items = useListItems(listId);
  const history = useTable("history");
  const deferred = useDeferredValue(query);
  const blank = deferred.trim() === "";

  const now = useMemo(() => new Date().toISOString(), [history]);
  const suggestions = useMemo(
    () => itemSuggestions({ query: deferred, listId, history, items, now, limit: SUGGESTION_ROWS }),
    [deferred, listId, history, items, now],
  );
  const frequent = useMemo(
    () => (blank ? frequentItems({ listId, history, items, now }) : []),
    [blank, listId, history, items, now],
  );

  if (frequent.length > 0) {
    return (
      <ScrollView
        horizontal
        accessibilityLabel="よく使う品目"
        className="-mx-4 grow-0"
        contentContainerClassName="gap-2 px-4"
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {frequent.map((item) => (
          <Chip key={item.normalizedName} onPress={() => onSelect(item.name)}>
            {item.name}
          </Chip>
        ))}
      </ScrollView>
    );
  }
  if (suggestions.length === 0) return null;
  return (
    <View className="overflow-hidden rounded-lg border border-border bg-surface">
      {suggestions.map((suggestion, index) => (
        <Pressable
          key={suggestion.normalizedName}
          accessibilityRole="button"
          onPress={() => onSelect(suggestion.name)}
          className={cx("min-h-12 flex-row items-center justify-between px-4 active:bg-surface-muted", index > 0 && "border-t border-border")}
        >
          <Text>{suggestion.name}</Text>
          {suggestion.origin === "otherList" && <Text className="text-xs text-fg-muted">ほかのリスト</Text>}
        </Pressable>
      ))}
    </View>
  );
}

interface AddItemBarProps {
  listId: Id;
  // 足した品目、またはすでにあった品目を一覧で見せる
  onShowItem: (id: Id) => void;
}

// リスト画面の下の入力欄。文字を打っても一覧を描き直さないよう、入力の状態はここに閉じる。
// カテゴリは過去の品目から待たずに決め、分からなければ未分類のまま入れる
export function AddItemBar({ listId, onShowItem }: AddItemBarProps) {
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [name, setName] = useState("");
  const [focused, setFocused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 戻るキーでキーボードを閉じてもフォーカスは残るので、候補と一緒に外す
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidHide", () => inputRef.current?.blur());
    return () => subscription.remove();
  }, []);

  const add = (itemName: string) => {
    if (itemName.trim() === "") return;
    const category = lookupCategory({
      name: itemName,
      listId,
      categories: localStore.rows("categories"),
      items: localStore.rows("items"),
      history: localStore.rows("history"),
    });
    const item = repository.addItem(listId, itemName, category);
    const shown = item ?? openItemNamed(localStore.rows("items"), listId, itemName);
    setName("");
    setNotice(item ? null : "すでにリストにあります");
    if (shown) onShowItem(shown.id);
  };

  return (
    <>
      {focused && <AddSuggestions listId={listId} query={name} onSelect={add} />}
      {notice !== null && (
        <Text accessibilityLiveRegion="polite" className="text-sm text-fg-muted">
          {notice}
        </Text>
      )}
      <View className="flex-row items-center gap-2">
        <Input
          ref={inputRef}
          className="min-w-0 flex-1"
          accessibilityLabel="品目の名前"
          placeholder="品目の名前"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setNotice(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setNotice(null);
          }}
          onSubmitEditing={() => add(name)}
          submitBehavior="submit"
          returnKeyType="done"
        />
        <Button variant="primary" size="lg" disabled={name.trim() === ""} onPress={() => add(name)}>
          追加
        </Button>
      </View>
    </>
  );
}
