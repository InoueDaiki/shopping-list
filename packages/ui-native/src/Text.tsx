import { Children, createContext, type ReactNode, useContext } from "react";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { cx } from "./cx.ts";
import { useForeground } from "./foreground.tsx";

// Text の中の Text は、親の大きさと色を引き継ぐ(既定のクラスを付けない)
const NestedContext = createContext(false);

export interface TextProps extends RNTextProps {
  className?: string;
}

// 文字。既定は text-base と、周り(ボタンや札)の色。React Native では、文字は必ずこの中に書く
export function Text({ className, ...props }: TextProps) {
  const nested = useContext(NestedContext);
  const fg = useForeground();
  const merged = nested ? className : cx("text-base", fg.textClass, className);
  return (
    <NestedContext value={true}>
      <RNText className={merged} {...props} />
    </NestedContext>
  );
}

// 子のうち、続いた文字列と数を1つの Text にまとめる(View に文字列を直に置けないため)
export function wrapText(children: ReactNode, className?: string): ReactNode {
  const out: ReactNode[] = [];
  let run: (string | number)[] = [];
  const flush = () => {
    if (run.length > 0) {
      out.push(
        <Text key={`t${out.length}`} className={className}>
          {run.join("")}
        </Text>,
      );
      run = [];
    }
  };
  Children.forEach(children, (c) => {
    if (typeof c === "string" || typeof c === "number") {
      run.push(c);
    } else if (c !== null && c !== undefined && typeof c !== "boolean") {
      flush();
      out.push(c);
    }
  });
  flush();
  return out;
}
