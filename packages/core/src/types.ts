// データの型。スプレッドシートの行と SQLite の行は、どちらもこの形に写す。
// 日時はすべて ISO 8601 の UTC の文字列。ID は端末で作る乱数の文字列。

export type Id = string;
export type Iso = string;

export interface ShoppingList {
  id: Id;
  name: string;
  sort: number;
  updatedAt: Iso;
}

export interface Category {
  id: Id;
  name: string;
  sort: number;
  updatedAt: Iso;
}

export interface Store {
  id: Id;
  name: string;
  // 位置の許可が無いときは null
  lat: number | null;
  lng: number | null;
  createdAt: Iso;
  updatedAt: Iso;
  // 属するリスト。null は移行の途中の状態で、どのリストにも出す
  listId: Id | null;
}

// history: 過去の品目から引いた。inferred: 推定した。user: 利用者が決めた
export type CategorySource = "history" | "inferred" | "user";

// 今リストにある品目
export interface Item {
  id: Id;
  // 属するリスト。null はどのリストにも属さない品目(野良品目)。リストの画面には出さず、
  // リスト一覧の「未整理」から選んだリストへ移す
  listId: Id | null;
  name: string;
  // 未分類は null
  categoryId: Id | null;
  categorySource: CategorySource | null;
  memo: string;
  checked: boolean;
  checkedAt: Iso | null;
  checkedStoreId: Id | null;
  // チェックの状態(checked、checkedAt、checkedStoreId)の版。買い物中に2人が触っても
  // チェックとほかの編集が消し合わないよう、updatedAt と別に比べる
  checkedUpdatedAt: Iso;
  // チェックの状態以外の版
  updatedAt: Iso;
}

// 買い終えた品目の記録。足すだけで書き換えない
export interface HistoryEntry {
  id: Id;
  listId: Id;
  name: string;
  categoryId: Id | null;
  // 品目から写す。利用者の修正は履歴へ移っても強い記録のまま残る
  categorySource: CategorySource | null;
  storeId: Id | null;
  // tripIdOf で決める
  tripId: Id | null;
  checkedAt: Iso;
  // トリップの中のチェックの順
  checkedSeq: number;
}

// 店舗ごとの手の順番
export interface StoreOrder {
  storeId: Id;
  categoryIds: Id[];
  editedAt: Iso;
}

// 品目名を忘れた記録。同じリストで、正規化した名前が同じで、forgottenAt までに買った履歴を、
// 候補、よく使う品目、カテゴリの引き当て、推定の学習から除く(withoutForgotten)。履歴は消さない
export interface ForgottenItem {
  id: Id;
  listId: Id;
  // normalizeItemName の結果
  normalizedName: string;
  // これまでに買った分を忘れる。忘れた後にまた買えば、その分からまた出る
  forgottenAt: Iso;
  updatedAt: Iso;
}
