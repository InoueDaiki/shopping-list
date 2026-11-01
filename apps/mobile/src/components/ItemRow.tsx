import type { Id, Item } from "@shopping-list/core";
import { Button, Checkbox, Icon } from "@shopping-list/ui-native";
import Pencil from "lucide-react-native/icons/pencil";
import StickyNote from "lucide-react-native/icons/sticky-note";
import { memo } from "react";
import { View } from "react-native";

interface ItemRowProps {
  item: Item;
  onToggle: (id: Id, checked: boolean) => void;
  onMemo: (item: Item) => void;
  onEdit: (id: Id) => void;
}

// 品目の1行。チェックの反応を速くするため、ほかの行が変わっても描き直さない
export const ItemRow = memo(function ItemRow({ item, onToggle, onMemo, onEdit }: ItemRowProps) {
  return (
    <View className="flex-row items-center gap-1 border-b border-border bg-surface pr-1 pl-4">
      <Checkbox
        className="min-w-0 flex-1"
        strike
        label={item.name}
        checked={item.checked}
        onChange={(checked) => onToggle(item.id, checked)}
      />
      {item.memo !== "" && (
        <Button icon variant="ghost" accessibilityLabel={`${item.name}のメモを見る`} onPress={() => onMemo(item)}>
          <Icon icon={StickyNote} size={20} color="accent-fg" />
        </Button>
      )}
      <Button icon variant="ghost" accessibilityLabel={`${item.name}を編集`} onPress={() => onEdit(item.id)}>
        <Icon icon={Pencil} size={18} color="fg-muted" />
      </Button>
    </View>
  );
});
