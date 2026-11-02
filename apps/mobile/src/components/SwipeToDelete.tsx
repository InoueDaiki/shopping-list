import { Icon } from "@shopping-list/ui-native";
import Trash2 from "lucide-react-native/icons/trash-2";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, View } from "react-native";

import { isDeleteSwipe, isHorizontalSwipe } from "../logic/swipe.ts";

interface SwipeToDeleteProps {
  // 読み上げの操作の名前に使う
  label: string;
  onDelete: () => void;
  children: ReactNode;
}

// 横へ払うと消す行。ジェスチャーのライブラリは自動リンクから外してあるので(軽さのため)、
// React Native の PanResponder と Animated だけで作る。縦のスクロールは奪わない
export function SwipeToDelete({ label, onDelete, children }: SwipeToDeleteProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, { dx, dy }) => isHorizontalSwipe(dx, dy),
        // 一度払い始めたら、一覧のスクロールに渡さない
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: Animated.event([null, { dx: translateX }], { useNativeDriver: false }),
        onPanResponderRelease: (_event, { dx, vx }) => {
          const rowWidth = widthRef.current;
          if (isDeleteSwipe(dx, vx, rowWidth)) {
            Animated.timing(translateX, { toValue: Math.sign(dx) * rowWidth, duration: 150, useNativeDriver: true }).start(() => {
              onDeleteRef.current();
              translateX.setValue(0);
            });
          } else {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () => Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [translateX],
  );

  return (
    <View
      onLayout={(event) => {
        widthRef.current = event.nativeEvent.layout.width;
        setWidth(event.nativeEvent.layout.width);
      }}
      accessibilityActions={[{ name: "delete", label: `${label}を削除` }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "delete") onDelete();
      }}
    >
      {width > 0 && (
        <View className="absolute inset-0 flex-row items-center justify-between bg-danger px-6">
          <Icon icon={Trash2} size={22} color="on-danger" />
          <Icon icon={Trash2} size={22} color="on-danger" />
        </View>
      )}
      <Animated.View style={{ transform: [{ translateX }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}
