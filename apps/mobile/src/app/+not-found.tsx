import { Button, FullScreenMessage } from "@shopping-list/ui-native";
import { router } from "expo-router";

export default function NotFound() {
  return (
    <FullScreenMessage action={<Button onPress={() => router.replace("/")}>リストの一覧へ</Button>}>画面が見つかりません。</FullScreenMessage>
  );
}
