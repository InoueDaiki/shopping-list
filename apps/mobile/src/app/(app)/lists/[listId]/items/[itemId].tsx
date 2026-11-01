import type { Id } from "@shopping-list/core";
import { Button, ConfirmDialog, Field, FullScreenMessage, Input, PageHeader, Select, Textarea } from "@shopping-list/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";

import { Page } from "../../../../../components/Page.tsx";
import { useTable } from "../../../../../data/hooks.ts";
import { repository } from "../../../../../data/runtime.ts";

const UNCATEGORIZED = "none";

// 品目の編集。カテゴリを直すと、次から同じ品目に使われる
export default function EditItem() {
  const { itemId } = useLocalSearchParams<{ itemId: Id }>();
  const items = useTable("items");
  const categories = useTable("categories");
  const item = items.find((row) => row.id === itemId);
  const [name, setName] = useState(item?.name ?? "");
  const [memo, setMemo] = useState(item?.memo ?? "");
  const [categoryId, setCategoryId] = useState<string>(item?.categoryId ?? UNCATEGORIZED);
  const [deleting, setDeleting] = useState(false);
  const options = useMemo(
    () => [{ value: UNCATEGORIZED, label: "未分類" }, ...categories.map((row) => ({ value: row.id, label: row.name }))],
    [categories],
  );

  if (!item) {
    return <FullScreenMessage action={<Button onPress={() => router.back()}>戻る</Button>}>この品目はもうありません。</FullScreenMessage>;
  }

  const save = () => {
    repository.updateItem(item.id, {
      name: name.trim(),
      memo,
      categoryId: categoryId === UNCATEGORIZED ? null : categoryId,
    });
    router.back();
  };

  return (
    <Page>
      <PageHeader title="品目を編集" />
      <Field label="品目の名前">
        <Input value={name} onChangeText={setName} />
      </Field>
      <Field label="カテゴリ">
        <Select value={categoryId} options={options} onChange={setCategoryId} />
      </Field>
      <Field label="メモ" hint="一覧には出ません。URL は押せるようになります">
        <Textarea value={memo} onChangeText={setMemo} />
      </Field>
      <Button variant="primary" size="lg" disabled={name.trim() === ""} onPress={save}>
        保存する
      </Button>
      <Button variant="ghost" onPress={() => setDeleting(true)}>
        この品目を削除
      </Button>
      <ConfirmDialog
        open={deleting}
        tone="danger"
        title="この品目を削除しますか"
        description="元に戻せません。"
        confirmLabel="削除する"
        onConfirm={() => {
          setDeleting(false);
          repository.deleteItem(item.id);
          router.back();
        }}
        onCancel={() => setDeleting(false)}
      />
    </Page>
  );
}
