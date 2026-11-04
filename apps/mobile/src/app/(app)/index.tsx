import type { ShoppingList } from "@shopping-list/core";
import { ActionSheet, Badge, Button, ConfirmDialog, cx, Icon, PageHeader, Text } from "@shopping-list/ui-native";
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
import { useStrayItems, useTable } from "../../data/hooks.ts";
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
              <Button icon variant="ghost" accessibilityLabel="リストを追加" onPress={() => setAdding(true)}>
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
                  <Text className="min-w-0 shrink text-lg font-medium">{list.name}</Text>
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
        onSubmit={(name) => repository.addList(name)}
        onClose={() => setAdding(false)}
      />
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
    </View>
  );
}
