import { crossListSuggestions, type CrossListSuggestion, type Id, type ShoppingList } from "@shopping-list/core";
import { ActionSheet, Button, cx, Input, SheetPanel, Text } from "@shopping-list/ui-native";
import { router } from "expo-router";
import { useDeferredValue, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { addListItem, addStrayItem } from "../../data/addItem.ts";
import { useTable } from "../../data/hooks.ts";
import { prepareItemInference } from "../../data/inference.ts";
import { localStore, repository } from "../../data/runtime.ts";
import { openItemNamed } from "../../logic/listRows.ts";

// 候補の行数の上限。キーボードと合わせて、面が画面を覆い切らない高さに抑える
const SUGGESTION_ROWS = 4;

// 足した結果。野良品目なら listId は null で、リストを選んで移せる
interface Added {
  id: Id;
  name: string;
  listId: Id | null;
  // 足さずに、すでにあった品目を見せている
  existed: boolean;
}

// 品目の追加。ホーム画面のウィジェットとアプリのショートカットから shoppinglist://quick-add で開く
// (docs/設計メモ.md の「ホーム画面のウィジェット」)。候補を選べばその候補のリストへ、
// 打った名前のまま追加すればどのリストにも属さない野良品目(未整理)にする。
// 画面は透明に重ね、下から出る面を描く(Modal を重ねない SheetPanel。キーボードがすぐ出る)。閉じると下の画面に戻る。
// ウィジェットとショートカットはタスクを作り直して開くので、下には一覧を敷いてある(./_layout.tsx の unstable_settings)
export default function QuickAdd() {
  const lists = useTable("lists");
  const [name, setName] = useState("");
  const [added, setAdded] = useState<Added | null>(null);
  const [choosing, setChoosing] = useState(false);
  const listNames = useMemo(() => new Map(lists.map((list) => [list.id, list.name])), [lists]);

  const addToList = (listId: Id, itemName: string) => {
    const item = addListItem(listId, itemName);
    const shown = item ?? openItemNamed(localStore.rows("items"), listId, itemName);
    setName("");
    if (shown) setAdded({ id: shown.id, name: shown.name, listId, existed: item === null });
  };

  const addStray = (itemName: string) => {
    if (itemName.trim() === "") return;
    const item = addStrayItem(itemName);
    const shown = item ?? openItemNamed(localStore.rows("items"), null, itemName);
    setName("");
    if (shown) setAdded({ id: shown.id, name: shown.name, listId: null, existed: item === null });
  };

  const moveTo = (list: ShoppingList) => {
    setChoosing(false);
    if (added === null) return;
    const moved = repository.moveStrayItem(added.id, list.id);
    if (moved) openList(list.id);
  };

  const listName = added?.listId ? listNames.get(added.listId) : undefined;

  return (
    <SheetPanel title="品目を追加" onClose={close}>
      <View className="gap-3">
        {added && (
          <View
            accessibilityLiveRegion="polite"
            className="gap-1 rounded-lg border border-border bg-surface-strong py-2 pr-2 pl-4"
          >
            <Text className="text-sm">{addedMessage(added, listName)}</Text>
            <View className="flex-row justify-end gap-2">
              {added.listId === null ? (
                <Button variant="link" onPress={() => setChoosing(true)}>
                  リストを選ぶ
                </Button>
              ) : (
                <Button variant="link" onPress={() => added.listId && openList(added.listId)}>
                  {`${listName ?? "リスト"}を開く`}
                </Button>
              )}
            </View>
          </View>
        )}
        {name.trim() !== "" && <Suggestions query={name} listNames={listNames} onSelect={(s) => addToList(s.listId, s.name)} />}
        <View className="flex-row items-center gap-2">
          <Input
            autoFocus
            className="min-w-0 flex-1"
            accessibilityLabel="品目の名前"
            placeholder="品目の名前"
            value={name}
            onChangeText={(text) => {
              setName(text);
              setAdded(null);
            }}
            onFocus={prepareItemInference}
            onSubmitEditing={() => addStray(name)}
            submitBehavior="submit"
            returnKeyType="done"
          />
          <Button
            variant="primary"
            size="lg"
            accessibilityLabel="未整理に追加"
            disabled={name.trim() === ""}
            onPress={() => addStray(name)}
          >
            追加
          </Button>
        </View>
        <Text className="text-xs text-fg-muted">候補を選ぶとそのリストへ、そのまま追加すると未整理に入ります。</Text>
      </View>

      <ActionSheet
        open={choosing}
        title={added ? `「${added.name}」を移すリスト` : ""}
        description={lists.length === 0 ? "リストがありません。リストの一覧の右上の + から追加してください。" : undefined}
        onCancel={() => setChoosing(false)}
        items={lists.map((list) => ({ label: list.name, onPress: () => moveTo(list) }))}
      />
    </SheetPanel>
  );
}

interface SuggestionsProps {
  query: string;
  listNames: ReadonlyMap<Id, string>;
  onSelect: (suggestion: CrossListSuggestion) => void;
}

// すべてのリストの過去の品目から、打った文字に合う名前をリストごとに出す
function Suggestions({ query, listNames, onSelect }: SuggestionsProps) {
  const lists = useTable("lists");
  const history = useTable("history");
  const forgotten = useTable("forgottenItems");
  const items = useTable("items");
  const deferred = useDeferredValue(query);
  const now = useMemo(() => new Date().toISOString(), [history]);
  const suggestions = useMemo(
    () => crossListSuggestions({ query: deferred, lists, history, forgotten, items, now, limit: SUGGESTION_ROWS }),
    [deferred, lists, history, forgotten, items, now],
  );
  if (suggestions.length === 0) return null;
  return (
    <View className="overflow-hidden rounded-lg border border-border bg-surface">
      {suggestions.map((suggestion, index) => (
        <Pressable
          key={`${suggestion.listId}:${suggestion.normalizedName}`}
          accessibilityRole="button"
          accessibilityLabel={`${suggestion.name}を${listNames.get(suggestion.listId) ?? ""}に追加`}
          onPress={() => onSelect(suggestion)}
          className={cx("min-h-12 flex-row items-center justify-between gap-2 px-4 active:bg-surface-muted", index > 0 && "border-t border-border")}
        >
          <Text className="min-w-0 flex-1">{suggestion.name}</Text>
          <Text className="text-xs text-fg-muted">{listNames.get(suggestion.listId)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function addedMessage(added: Added, listName: string | undefined): string {
  const place = added.listId === null ? "未整理" : (listName ?? "リスト");
  return added.existed ? `「${added.name}」はすでに${place}にあります` : `「${added.name}」を${place}に追加しました`;
}

// 面を閉じてリストの画面へ進む。戻ると一覧に出る
function openList(listId: Id) {
  router.replace(`/lists/${listId}`);
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
