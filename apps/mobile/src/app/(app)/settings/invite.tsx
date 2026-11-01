import { Alert, Button, PageHeader, Text } from "@shopping-list/ui-native";
import { Linking, Share, View } from "react-native";

import { Page } from "../../../components/Page.tsx";
import { useSheet } from "../../../data/hooks.ts";
import { inviteMessage } from "../../../logic/invite.ts";

// 招待。今のスコープでは共有を操作できないので、編集の権限は利用者が Google の画面で渡す
export default function Invite() {
  const sheet = useSheet();
  if (!sheet) return null;
  return (
    <Page>
      <PageHeader title="招待する" />
      <Alert tone="warning">
        招待リンクを送っても、シートの権限は渡せません。先に Google スプレッドシートの「共有」から、相手に編集者の権限を渡してください。
      </Alert>
      <View className="gap-1">
        <Text className="text-sm font-medium">1. 編集の権限を渡す</Text>
        <Button onPress={() => void Linking.openURL(sheet.spreadsheetUrl)}>シートを開く</Button>
      </View>
      <View className="gap-1">
        <Text className="text-sm font-medium">2. リンクを送る</Text>
        {/* シート ID は、ここで利用者が選んだ相手にだけ渡る */}
        <Button variant="primary" onPress={() => void Share.share({ message: inviteMessage(sheet) })}>
          招待を送る
        </Button>
      </View>
    </Page>
  );
}
