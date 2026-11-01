import type { ColorName } from "@shopping-list/design-tokens/native";
import type { LucideIcon } from "lucide-react-native";

import { useForeground, useTokenColor } from "./foreground.tsx";

export interface IconProps {
  // Lucide のアイコン(lucide-react-native)
  icon: LucideIcon;
  // 一辺(px)
  size?: number;
  // 色のトークン。無ければ周り(ボタンや札)の色
  color?: ColorName;
  // 名前。飾りなら付けない(読み上げない)
  accessibilityLabel?: string;
}

// アイコン。色はクラスではなくトークンの名前で渡す(SVG の色は style で決まらないため)
export function Icon({ icon: Component, size = 16, color, accessibilityLabel }: IconProps) {
  const fg = useForeground();
  const value = useTokenColor(color ?? fg.color);
  return (
    <Component
      size={size}
      color={value}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
