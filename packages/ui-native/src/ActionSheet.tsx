import { useEffect, useRef } from "react";
import { Modal, Platform, Pressable, View } from "react-native";

import { Button } from "./Button.tsx";
import { Text } from "./Text.tsx";

export interface ActionSheetItem {
  label: string;
  onPress: () => void;
  // danger: 削除など取り返しのつかない操作
  tone?: "default" | "danger";
}

export interface ActionSheetProps {
  open: boolean;
  title: string;
  description?: string;
  items: ActionSheetItem[];
  cancelLabel?: string;
  // 取りやめ(取りやめのボタン、幕、Android の戻るキー)
  onCancel: () => void;
}

// 画面の下に出す、操作の一覧(店舗を替える、品目を消す、など)。
// 項目を押すと onCancel で閉じてもらい、閉じ終えてから項目の onPress を呼ぶ。閉じる途中に
// 別のダイアログや端末の画面を開くと、iOS では何も起きないため
export function ActionSheet({ open, title, description, items, cancelLabel = "やめる", onCancel }: ActionSheetProps) {
  const pending = useRef<(() => void) | undefined>(undefined);
  const runPending = () => {
    const run = pending.current;
    pending.current = undefined;
    run?.();
  };
  // Android の Modal は閉じ終えた合図(onDismiss)を出さないことがあるので、閉じたらすぐに動かす
  useEffect(() => {
    if (!open && Platform.OS !== "ios") {
      runPending();
    }
  }, [open]);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel} onDismiss={runPending}>
      {/* 幕は中身の後ろの別の要素にする(中身を包むと、読み上げで中のボタンを選べなくなる) */}
      <View className="flex-1 justify-end bg-overlay p-4 pb-safe-or-4">
        <Pressable accessibilityLabel="閉じる" className="absolute inset-0" onPress={onCancel} />
        <View accessibilityViewIsModal className="w-full max-w-md gap-2 self-center rounded-xl border border-border bg-surface p-4">
          <Text accessibilityRole="header" className="font-bold">
            {title}
          </Text>
          {description && <Text className="text-sm text-fg-muted">{description}</Text>}
          <View className="mt-1 gap-2">
            {items.map((item) => (
              <Button
                key={item.label}
                size="lg"
                variant={item.tone === "danger" ? "danger" : "secondary"}
                onPress={() => {
                  pending.current = item.onPress;
                  onCancel();
                }}
              >
                {item.label}
              </Button>
            ))}
            <Button size="lg" variant="ghost" onPress={onCancel}>
              {cancelLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
