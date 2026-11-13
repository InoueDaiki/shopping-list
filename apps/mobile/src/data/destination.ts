// 保存先(docs/設計メモ.md の「保存先」)。リストごとに選び、端末の SQLite の行に持つ。シートには送らない
export type Destination = "local" | "sheets";

export const DESTINATION_LABELS: Record<Destination, string> = {
  local: "アプリ内",
  sheets: "スプレッドシート",
};
