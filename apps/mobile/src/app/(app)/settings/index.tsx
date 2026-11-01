import { Icon, PageHeader, Text } from "@shopping-list/ui-native";
import { type Href, router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Page } from "../../../components/Page.tsx";

const ENTRIES: readonly { label: string; href: Href }[] = [
  { label: "店舗とカテゴリの順番", href: "/settings/stores" },
  { label: "カテゴリ", href: "/settings/categories" },
  { label: "アカウント", href: "/settings/account" },
];

export default function SettingsHome() {
  return (
    <Page>
      <PageHeader title="設定" />
      <View className="overflow-hidden rounded-lg border border-border bg-surface">
        {ENTRIES.map(({ label, href }) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            onPress={() => router.push(href)}
            className="min-h-14 flex-row items-center justify-between border-b border-border px-4 active:bg-surface-muted"
          >
            <Text>{label}</Text>
            <Icon icon={ChevronRight} size={20} color="fg-muted" />
          </Pressable>
        ))}
      </View>
    </Page>
  );
}
