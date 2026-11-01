import type { Id } from "@shopping-list/core";
import { Button, Chip, Sheet, Text } from "@shopping-list/ui-native";
import { View } from "react-native";

import { useTable } from "../data/hooks.ts";

interface CategorySheetProps {
  // 分類する品目の名前。null なら閉じている
  itemName: string | null;
  onSelect: (categoryId: Id) => void;
  onClose: () => void;
}

// 過去に無い品目のカテゴリを、その場で選ぶ
export function CategorySheet({ itemName, onSelect, onClose }: CategorySheetProps) {
  const categories = useTable("categories");
  return (
    <Sheet
      open={itemName !== null}
      title="カテゴリを選ぶ"
      onClose={onClose}
      footer={<Button onPress={onClose}>未分類のままにする</Button>}
    >
      <Text className="text-sm text-fg-muted">{itemName}</Text>
      <View className="flex-row flex-wrap gap-2">
        {categories.map((category) => (
          <Chip key={category.id} onPress={() => onSelect(category.id)}>
            {category.name}
          </Chip>
        ))}
      </View>
    </Sheet>
  );
}
