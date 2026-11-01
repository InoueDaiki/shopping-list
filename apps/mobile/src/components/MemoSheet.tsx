import type { Item } from "@shopping-list/core";
import { Button, Sheet, Text } from "@shopping-list/ui-native";
import { Linking } from "react-native";

import { splitMemo } from "../logic/memo.ts";

interface MemoSheetProps {
  item: Item | null;
  onEdit: (item: Item) => void;
  onClose: () => void;
}

// 品目のメモ。URL は押すとブラウザで開く
export function MemoSheet({ item, onEdit, onClose }: MemoSheetProps) {
  return (
    <Sheet
      open={item !== null}
      title={item?.name ?? ""}
      onClose={onClose}
      footer={item && <Button onPress={() => onEdit(item)}>編集する</Button>}
    >
      <Text selectable className="leading-relaxed">
        {splitMemo(item?.memo ?? "").map((part, index) =>
          part.url ? (
            <Text key={index} accessibilityRole="link" className="underline" onPress={() => void Linking.openURL(part.text)}>
              {part.text}
            </Text>
          ) : (
            part.text
          ),
        )}
      </Text>
    </Sheet>
  );
}
