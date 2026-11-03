import { Button, cx, Text } from "@shopping-list/ui-native";
import { View } from "react-native";

interface UndoNoticeProps {
  message: string;
  onUndo: () => void;
  className?: string;
}

// 払って消した直後の、取り消しの帯(usePendingDelete と組で使う)
export function UndoNotice({ message, onUndo, className }: UndoNoticeProps) {
  return (
    <View
      accessibilityLiveRegion="polite"
      className={cx("flex-row items-center gap-2 rounded-lg border border-border bg-surface-strong py-1 pr-2 pl-4", className)}
    >
      <Text numberOfLines={1} className="min-w-0 flex-1 text-sm">
        {message}
      </Text>
      <Button variant="link" onPress={onUndo}>
        元に戻す
      </Button>
    </View>
  );
}
