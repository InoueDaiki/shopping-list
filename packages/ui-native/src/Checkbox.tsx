import Check from "lucide-react-native/icons/check";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";
import { wrapText } from "./Text.tsx";

export interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  // ラベルの下に添える説明
  description?: ReactNode;
  // チェックしたら文字に取り消し線を引いて薄くする(買った品目)
  strike?: boolean;
  disabled?: boolean;
  className?: string;
}

// ラベル付きのチェックボックス。買った印は緑(success)。行全体を押せて、高さは指で押せる 48 を保つ
export function Checkbox({ label, checked, onChange, description, strike = false, disabled, className }: CheckboxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      className={cx("min-h-12 flex-row items-center gap-3", disabled && "opacity-50", className)}
    >
      <View
        className={cx(
          "size-6 items-center justify-center rounded-sm border-2",
          checked ? "border-success bg-success" : "border-border-strong bg-surface",
        )}
      >
        {checked && <Icon icon={Check} size={16} color="on-success" />}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        {wrapText(label, cx("text-base", strike && checked && "text-fg-muted line-through"))}
        {description && wrapText(description, "text-xs text-fg-muted")}
      </View>
    </Pressable>
  );
}
