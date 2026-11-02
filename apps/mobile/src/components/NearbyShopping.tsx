import { nearestStore, type GeoPoint } from "@shopping-list/core";
import { Icon, Text } from "@shopping-list/ui-native";
import { router, useFocusEffect } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import MapPin from "lucide-react-native/icons/map-pin";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { useTable } from "../data/hooks.ts";
import { watchPositionOnce } from "../data/location.ts";
import { repository } from "../data/runtime.ts";

// いちばん近い店舗で買い物を始めるボタン。位置を持ちリストに属する店舗があるときだけ測る。
// 店舗が無ければ位置の許可を求めず、測る間も一覧の表示を待たせない
export function NearbyShopping() {
  const lists = useTable("lists");
  const stores = useTable("stores");
  const [position, setPosition] = useState<GeoPoint | null>(null);

  const candidates = useMemo(
    () => stores.filter((store) => store.lat !== null && store.lng !== null && lists.some((list) => list.id === store.listId)),
    [stores, lists],
  );
  const measurable = candidates.length > 0;

  useFocusEffect(
    useCallback(() => {
      if (!measurable) return undefined;
      let focused = true;
      void watchPositionOnce((point) => {
        if (focused) setPosition(point);
      });
      return () => {
        focused = false;
      };
    }, [measurable]),
  );

  const nearest = useMemo(() => nearestStore(candidates, position)?.store, [candidates, position]);
  const list = lists.find((row) => row.id === nearest?.listId);
  if (!nearest || !list) return null;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        repository.selectStore(list.id, nearest.id);
        router.push(`/lists/${list.id}`);
      }}
      className="min-h-14 flex-row items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 active:bg-surface-muted"
    >
      <Icon icon={MapPin} size={20} color="primary-fg" />
      <View className="min-w-0 flex-1">
        <Text className="font-medium">{`${nearest.name}で買い物を始める`}</Text>
        <Text className="text-xs text-fg-muted">{list.name}</Text>
      </View>
      <Icon icon={ChevronRight} size={20} color="fg-muted" />
    </Pressable>
  );
}
