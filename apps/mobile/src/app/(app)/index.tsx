import type { ShoppingList } from "@shopping-list/core";
import { ActionSheet, Badge, Button, Chip, ConfirmDialog, cx, Icon, PageHeader, Text } from "@shopping-list/ui-native";
import { router } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import Inbox from "lucide-react-native/icons/inbox";
import Plus from "lucide-react-native/icons/plus";
import Settings from "lucide-react-native/icons/settings";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { NamePrompt } from "../../components/NamePrompt.tsx";
import { NearbyShopping } from "../../components/NearbyShopping.tsx";
import { SyncNoticeBar } from "../../components/SyncNoticeBar.tsx";
import { DESTINATION_LABELS, type Destination } from "../../data/destination.ts";
import { useListDestinations, useSheetsConnected, useStrayItems, useTable } from "../../data/hooks.ts";
import { repository } from "../../data/runtime.ts";

// リストの一覧
export default function Lists() {
  const lists = useTable("lists");
  const items = useTable("items");
  const strays = useStrayItems();
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<ShoppingList | null>(null);
  const [renaming, setRenaming] = useState<ShoppingList | null>(null);
  const [deleting, setDeleting] = useState<ShoppingList | null>(null);
  // 保存先は、スプレッドシートをつないでいるときだけ選ぶ。つないでいなければ全部がアプリ内
  const connected = useSheetsConnected();
  const destinations = useListDestinations();
  const [newDest, setNewDest] = useState<Destination>("sheets");
  const [moving, setMoving] = useState<ShoppingList | null>(null);
  const movingTo: Destination = moving !== null && destinations.get(moving.id) === "local" ? "sheets" : "local";

  const remaining = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.checked && item.listId !== null) counts.set(item.listId, (counts.get(item.listId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView contentContainerClassName="gap-4 px-4 pt-safe-offset-4 pb-4">
        <PageHeader
          title="買い物リスト"
          actions={
            <View className="flex-row">
              <Button icon variant="ghost" accessibilityLabel="リストを追加" onPress={() => {
                  setNewDest("sheets");
                  setAdding(true);
                }}
              >
                <Icon icon={Plus} size={22} />
              </Button>
              <Button icon variant="ghost" accessibilityLabel="設定" onPress={() => router.push("/settings")}>
                <Icon icon={Settings} size={22} />
              </Button>
            </View>
          }
        />
        <SyncNoticeBar />
        {lists.length === 0 ? (
          <Text className="py-8 text-center text-fg-muted">リストがありません。右上の + から追加してください。</Text>
        ) : (
          <View className="overflow-hidden rounded-lg border border-border bg-surface">
            {lists.map((list, index) => (
              <View key={list.id} className={cx("flex-row items-center pr-1", index > 0 && "border-t border-border")}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/lists/${list.id}`)}
                  className="min-h-20 min-w-0 flex-1 flex-row items-center gap-3 pl-5 active:bg-surface-muted"
                >
                  <View className="min-w-0 shrink">
                    <Text className="text-lg font-medium">{list.name}</Text>
                    {connected && destinations.get(list.id) === "local" && (
                      <Text className="text-xs text-fg-muted">{DESTINATION_LABELS.local}</Text>
                    )}
                  </View>
                  {(remaining.get(list.id) ?? 0) > 0 && (
                    <View>
                      <Badge>{remaining.get(list.id) ?? 0}</Badge>
                    </View>
                  )}
                </Pressable>
                <Button icon variant="ghost" accessibilityLabel={`${list.name}の操作`} onPress={() => setTarget(list)}>
                  <Icon icon={EllipsisVertical} size={20} color="fg-muted" />
                </Button>
              </View>
            ))}
          </View>
        )}
        {strays.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`未整理の品目 ${strays.length}件。リストへ移す`}
            onPress={() => router.push("/stray")}
            className="min-h-16 flex-row items-center gap-3 rounded-lg border border-border bg-surface px-5 active:bg-surface-muted"
          >
            <Icon icon={Inbox} size={20} color="fg-muted" />
            <Text className="min-w-0 shrink font-medium">未整理</Text>
            <View>
              <Badge tone="accent">{strays.length}</Badge>
            </View>
            <View className="flex-1" />
            <Icon icon={ChevronRight} size={20} color="fg-muted" />
          </Pressable>
        )}
      </ScrollView>
      <View className="px-4 pt-2 pb-safe-or-4">
        <NearbyShopping />
      </View>

      <NamePrompt
        open={adding}
        title="リストを追加"
        label="リストの名前"
        confirmLabel="追加する"
        onSubmit={(name) => repository.addList(name, connected ? newDest : undefined)}
        onClose={() => setAdding(false)}
      >
        {connected && (
          <View className="gap-2">
            <Text className="text-sm font-medium">保存先</Text>
            <View className="flex-row flex-wrap gap-2">
              {(["sheets", "local"] as const).map((dest) => (
                <Chip key={dest} selected={newDest === dest} onPress={() => setNewDest(dest)}>
                  {DESTINATION_LABELS[dest]}
                </Chip>
              ))}
            </View>
            <Text className="text-xs text-fg-muted">
              {newDest === "sheets" ? "シートを共有している相手と一緒に使えます。" : "この端末だけに保存し、共有しません。"}
            </Text>
          </View>
        )}
      </NamePrompt>
      <NamePrompt
        open={renaming !== null}
        title="名前を変える"
        label="リストの名前"
        initial={renaming?.name}
        confirmLabel="保存する"
        onSubmit={(name) => renaming && repository.renameList(renaming.id, name)}
        onClose={() => setRenaming(null)}
      />
      <ActionSheet
        open={target !== null}
        title={target?.name ?? ""}
        onCancel={() => setTarget(null)}
        items={[
          { label: "名前を変える", onPress: () => setRenaming(target) },
          { label: "品目の管理", onPress: () => target && router.push(`/lists/${target.id}/registered`) },
          ...(connected ? [{ label: "保存先を変える", onPress: () => setMoving(target) }] : []),
          { label: "削除する", tone: "danger", onPress: () => setDeleting(target) },
        ]}
      />
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={`「${deleting?.name ?? ""}」を削除しますか`}
        description="リストの品目と店舗も一緒に削除します。元に戻せません。"
        confirmLabel="削除する"
        onConfirm={() => {
          if (deleting) repository.deleteList(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={moving !== null}
        tone={movingTo === "local" ? "danger" : undefined}
        title={`「${moving?.name ?? ""}」を${DESTINATION_LABELS[movingTo]}へ移しますか`}
        description={
          movingTo === "local"
            ? "スプレッドシートから消え、一緒に使っている相手のリストからも消えます。品目や店舗は、この端末にだけ残ります。"
            : "品目や店舗、買い物の記録をスプレッドシートへ送ります。シートを共有している相手も使えるようになります。"
        }
        confirmLabel={`${DESTINATION_LABELS[movingTo]}へ移す`}
        onConfirm={() => {
          if (moving) repository.moveList(moving.id, movingTo);
          setMoving(null);
        }}
        onCancel={() => setMoving(null)}
      />
    </View>
  );
}
