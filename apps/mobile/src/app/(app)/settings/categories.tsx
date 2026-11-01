import type { Category } from "@shopping-list/core";
import { ActionSheet, Badge, Button, ConfirmDialog, cx, Icon, PageHeader } from "@shopping-list/ui-native";
import { ArrowDown, ArrowUp, EllipsisVertical, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { NamePrompt } from "../../../components/NamePrompt.tsx";
import { Page } from "../../../components/Page.tsx";
import { useTable } from "../../../data/hooks.ts";
import { repository } from "../../../data/runtime.ts";
import { categoryToneMap } from "../../../logic/categoryTone.ts";

// カテゴリのマスタの編集。ここの順は、まだ順番を学んでいない店舗と、店舗を選んでいないときに使う
export default function Categories() {
  const categories = useTable("categories");
  const tones = useMemo(() => categoryToneMap(categories), [categories]);
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<Category | null>(null);
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  return (
    <Page>
      <PageHeader
        title="カテゴリ"
        actions={
          <Button icon variant="ghost" accessibilityLabel="カテゴリを追加" onPress={() => setAdding(true)}>
            <Icon icon={Plus} size={22} />
          </Button>
        }
      />
      <View className="overflow-hidden rounded-lg border border-border bg-surface">
        {categories.map((category, index) => (
          <View key={category.id} className={cx("min-h-12 flex-row items-center gap-1 pr-1 pl-4", index > 0 && "border-t border-border")}>
            <View className="min-w-0 flex-1">
              <Badge tone={tones.get(category.id) ?? "neutral"}>{category.name}</Badge>
            </View>
            <Button
              icon
              variant="ghost"
              disabled={index === 0}
              accessibilityLabel={`${category.name}を上へ`}
              onPress={() => repository.moveCategory(category.id, -1)}
            >
              <Icon icon={ArrowUp} size={20} />
            </Button>
            <Button
              icon
              variant="ghost"
              disabled={index === categories.length - 1}
              accessibilityLabel={`${category.name}を下へ`}
              onPress={() => repository.moveCategory(category.id, 1)}
            >
              <Icon icon={ArrowDown} size={20} />
            </Button>
            <Button icon variant="ghost" accessibilityLabel={`${category.name}の操作`} onPress={() => setTarget(category)}>
              <Icon icon={EllipsisVertical} size={20} color="fg-muted" />
            </Button>
          </View>
        ))}
      </View>

      <NamePrompt
        open={adding}
        title="カテゴリを追加"
        label="カテゴリの名前"
        confirmLabel="追加する"
        onSubmit={(name) => repository.addCategory(name)}
        onClose={() => setAdding(false)}
      />
      <NamePrompt
        open={renaming !== null}
        title="名前を変える"
        label="カテゴリの名前"
        initial={renaming?.name}
        confirmLabel="保存する"
        onSubmit={(name) => renaming && repository.renameCategory(renaming.id, name)}
        onClose={() => setRenaming(null)}
      />
      <ActionSheet
        open={target !== null}
        title={target?.name ?? ""}
        onCancel={() => setTarget(null)}
        items={[
          { label: "名前を変える", onPress: () => setRenaming(target) },
          { label: "削除する", tone: "danger", onPress: () => setDeleting(target) },
        ]}
      />
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={`「${deleting?.name ?? ""}」を削除しますか`}
        description="このカテゴリの品目は未分類になります。"
        confirmLabel="削除する"
        onConfirm={() => {
          if (deleting) repository.deleteCategory(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </Page>
  );
}
