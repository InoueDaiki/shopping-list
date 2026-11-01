// 中の文字とアイコンの色(CSS の継承の代わり)。React Native は文字の色を親から引き継がないので、
// ボタンや札が色を決め、中の Text と Icon がここから読む
import { colors, type ColorName } from "@shopping-list/design-tokens/native";
import { createContext, type ReactNode, useContext } from "react";
import { useColorScheme } from "react-native";

export interface Foreground {
  // 文字の色と太さなどのクラス
  textClass: string;
  // アイコンの色
  color: ColorName;
}

const ForegroundContext = createContext<Foreground>({ textClass: "text-fg", color: "fg" });

export function ForegroundProvider({ value, children }: { value: Foreground; children: ReactNode }) {
  return <ForegroundContext value={value}>{children}</ForegroundContext>;
}

export function useForeground(): Foreground {
  return useContext(ForegroundContext);
}

// トークンの色の値(OS の明暗に合わせる)。クラスを書けないところ(アイコン、入力欄の placeholder)で使う
export function useTokenColor(name: ColorName): string {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return colors[scheme][name];
}
