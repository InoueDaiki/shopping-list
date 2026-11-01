import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from "react-native";

import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import { Text } from "./Text.tsx";

export interface SheetProps {
  // 開いているか。開け閉めは呼び出し側が持つ
  open: boolean;
  title: string;
  // 閉じる(閉じるボタン、幕、Android の戻るキー)
  onClose: () => void;
  // 中身の下に固定して置く操作(保存など)
  footer?: ReactNode;
  children: ReactNode;
}

// 画面の下から出す面(品目のメモ、カテゴリの編集など)。中身が長ければスクロールする。
// 入力欄を置いてもキーボードに隠れないよう、面ごと持ち上げる
export function Sheet({ open, title, onClose, footer, children }: SheetProps) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      {/* 幕は中身の後ろの別の要素にする(中身を包むと、読み上げで中のボタンを選べなくなる) */}
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end bg-overlay">
        <Pressable accessibilityLabel="閉じる" className="absolute inset-0" onPress={onClose} />
        <View accessibilityViewIsModal className="max-h-[85%] w-full rounded-t-xl bg-surface pb-safe-or-4">
          <View className="flex-row items-center gap-2 border-b border-border py-2 pr-2 pl-4">
            <Text accessibilityRole="header" className="min-w-0 flex-1 font-bold">
              {title}
            </Text>
            <Button icon variant="ghost" accessibilityLabel="閉じる" onPress={onClose}>
              <Icon icon={X} size={20} />
            </Button>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3 p-4">
            {children}
          </ScrollView>
          {footer && <View className="gap-2 px-4 pt-2">{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
