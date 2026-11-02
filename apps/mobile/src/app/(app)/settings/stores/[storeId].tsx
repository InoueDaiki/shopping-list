import type { Id, Store } from "@shopping-list/core";
import { Button, ConfirmDialog, cx, Field, FullScreenMessage, Icon, Input, PageHeader, Select, Text } from "@shopping-list/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import { useMemo, useState } from "react";
import { Linking, View } from "react-native";

import { Page } from "../../../../components/Page.tsx";
import { useOrder, useTable } from "../../../../data/hooks.ts";
import { watchPositionOnce } from "../../../../data/location.ts";
import { repository } from "../../../../data/runtime.ts";
import { formatCoordinates, geoUrl, parseCoordinates } from "../../../../logic/coordinates.ts";
import { moveInOrder } from "../../../../logic/moveInOrder.ts";

function coordinatesOf(store: Store | undefined): string {
  return store && store.lat !== null && store.lng !== null ? formatCoordinates({ lat: store.lat, lng: store.lng }) : "";
}

// 店舗の名前、リスト、位置、カテゴリの順番の編集。手の順番は、次に学習に使えるトリップが終わるまでそのまま出る
export default function StoreDetail() {
  const { storeId } = useLocalSearchParams<{ storeId: Id }>();
  const stores = useTable("stores");
  const lists = useTable("lists");
  const categories = useTable("categories");
  const store = stores.find((row) => row.id === storeId);
  const learned = useOrder(storeId);
  const [name, setName] = useState(store?.name ?? "");
  const [listId, setListId] = useState(store?.listId ?? undefined);
  // 座標は入力欄の文字が正。触っていなければ保存で書き換えない
  const [openedCoordinates] = useState(coordinatesOf(store));
  const [coordinates, setCoordinates] = useState(openedCoordinates);
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [order, setOrder] = useState<readonly Id[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const names = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);
  const shown = order ?? learned;

  if (!store) {
    return <FullScreenMessage action={<Button onPress={() => router.back()}>戻る</Button>}>この店舗はもうありません。</FullScreenMessage>;
  }

  const point = parseCoordinates(coordinates);
  const noPosition = coordinates.trim() === "";
  const invalid = point === null && !noPosition;

  const locate = async () => {
    setLocating(true);
    setLocationNotice(null);
    // 途中で知らされる前回の位置は別の場所のことがあるので、測り終えた位置だけを使う
    const measured = await watchPositionOnce(() => undefined);
    setLocating(false);
    if (measured) setCoordinates(formatCoordinates(measured));
    else setLocationNotice("位置を取れませんでした。位置の許可を確かめてください。");
  };

  const openMap = () => {
    if (!point) return;
    setLocationNotice(null);
    Linking.openURL(geoUrl(point)).catch(() => setLocationNotice("地図を開けるアプリが見つかりませんでした。"));
  };

  const save = () => {
    const patch: Parameters<typeof repository.updateStore>[1] = {};
    if (name.trim() !== store.name) patch.name = name.trim();
    if (listId !== undefined && listId !== store.listId) patch.listId = listId;
    if (coordinates !== openedCoordinates) {
      patch.lat = point?.lat ?? null;
      patch.lng = point?.lng ?? null;
    }
    if (Object.keys(patch).length > 0) repository.updateStore(store.id, patch);
    if (order) repository.saveStoreOrder(store.id, [...order]);
    router.back();
  };

  return (
    <Page>
      <PageHeader title="店舗を編集" />
      <Field label="店舗の名前">
        <Input value={name} onChangeText={setName} />
      </Field>
      <Field label="リスト" hint="このリストの買い物で選べます">
        <Select value={listId} options={lists.map((list) => ({ value: list.id, label: list.name }))} onChange={setListId} placeholder="リストを選ぶ" />
      </Field>
      <Field
        label="店舗の位置"
        hint="緯度と経度。Google マップで長押ししてコピーした座標を貼れます"
        error={invalid ? "「35.0000, 139.0000」の形で入れてください" : (locationNotice ?? undefined)}
      >
        <Input value={coordinates} onChangeText={setCoordinates} placeholder="35.0000, 139.0000" autoCapitalize="none" autoCorrect={false} />
      </Field>
      <View className="flex-row flex-wrap gap-2">
        <Button size="sm" disabled={locating} onPress={() => void locate()}>
          {locating ? "測っています" : "今の位置にする"}
        </Button>
        <Button size="sm" disabled={point === null} onPress={openMap}>
          地図で見る
        </Button>
        <Button size="sm" disabled={noPosition} onPress={() => setCoordinates("")}>
          位置を消す
        </Button>
      </View>
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
      <Button variant="primary" size="lg" disabled={name.trim() === "" || invalid} onPress={save}>
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
