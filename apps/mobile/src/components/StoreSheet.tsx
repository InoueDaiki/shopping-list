import { checksFromItems, storeCandidates, storeLastUsed, type GeoPoint, type Id } from "@shopping-list/core";
import { Badge, Button, cx, Field, Input, Sheet, Text } from "@shopping-list/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { useTable } from "../data/hooks.ts";
import { watchPositionOnce } from "../data/location.ts";
import { repository } from "../data/runtime.ts";
import { refinedPosition } from "../logic/storePosition.ts";

interface StoreSheetProps {
  open: boolean;
  onClose: () => void;
}

// 今の店舗を選ぶ。一覧は待たずに出し、位置が分かったら近い店舗を上へ動かす
export function StoreSheet({ open, onClose }: StoreSheetProps) {
  const stores = useTable("stores");
  const items = useTable("items");
  const history = useTable("history");
  const [position, setPosition] = useState<GeoPoint | null>(null);
  const [name, setName] = useState("");
  const measuring = useRef<Promise<GeoPoint | null>>(Promise.resolve(null));

  useEffect(() => {
    if (open) {
      setName("");
      measuring.current = watchPositionOnce(setPosition);
    }
  }, [open]);

  const candidates = useMemo(
    () =>
      // 閉じている間はチェックのたびに計算しない
      open
        ? storeCandidates({
            stores,
            position,
            lastUsed: storeLastUsed([...history, ...checksFromItems(items)]),
          })
        : [],
    [open, stores, position, history, items],
  );

  const select = (storeId: Id) => {
    repository.selectStore(storeId);
    onClose();
  };

  const register = () => {
    if (name.trim() === "") return;
    // 同じ名前の店舗があれば登録せずに選ぶ。別の場所の位置で上書きしない
    const known = repository.findStore(name);
    const storeId = known?.id ?? repository.addStore(name, position);
    select(storeId);
    if (known) return;
    // 測り終える前に登録したら、分かったときに位置を足す。手元の位置は前回の場所のことがある
    void measuring.current.then((point) => {
      const refined = refinedPosition(position, point);
      if (refined) repository.updateStore(storeId, refined);
    });
  };

  return (
    <Sheet open={open} title="どの店舗で買いますか" onClose={onClose} footer={<Button onPress={onClose}>スキップ</Button>}>
      {candidates.length > 0 && (
        <View className="overflow-hidden rounded-lg border border-border">
          {candidates.map(({ store, nearby, distanceM }, index) => (
            <Pressable
              key={store.id}
              accessibilityRole="button"
              onPress={() => select(store.id)}
              className={cx("min-h-12 flex-row items-center justify-between gap-2 px-4 active:bg-surface-muted", index > 0 && "border-t border-border")}
            >
              <Text className="min-w-0 flex-1">{store.name}</Text>
              {nearby && <Badge tone="success">近い</Badge>}
              {!nearby && distanceM !== null && distanceM < 100_000 && (
                <Text className="text-xs text-fg-muted">{`${(distanceM / 1000).toFixed(1)} km`}</Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
      <Field label="新しい店舗を登録" hint="今の位置も一緒に保存します">
        <Input value={name} onChangeText={setName} placeholder="店舗の名前" onSubmitEditing={register} returnKeyType="done" />
      </Field>
      <Button variant="primary" disabled={name.trim() === ""} onPress={register}>
        登録して選ぶ
      </Button>
    </Sheet>
  );
}
