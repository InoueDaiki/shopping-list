// データの型。スプレッドシートの行と SQLite の行は、どちらもこの形に写す。
// 日時はすべて ISO 8601 の UTC の文字列。ID は端末で作る乱数の文字列。

export type Id = string;
export type Iso = string;

export interface ShoppingList {
  id: Id;
  name: string;
  sort: number;
}

export interface Category {
  id: Id;
  name: string;
  sort: number;
}

export interface Store {
  id: Id;
  name: string;
  // 位置の許可が無いときは null
  lat: number | null;
  lng: number | null;
  createdAt: Iso;
}

// history: 過去の品目から引いた。inferred: 推定した。user: 利用者が決めた
export type CategorySource = "history" | "inferred" | "user";

// 今リストにある品目
export interface Item {
  id: Id;
  listId: Id;
  name: string;
  // 未分類は null
  categoryId: Id | null;
  categorySource: CategorySource | null;
  memo: string;
  checked: boolean;
  checkedAt: Iso | null;
  checkedStoreId: Id | null;
  updatedAt: Iso;
}

// 買い終えた品目の記録。足すだけで書き換えない
export interface HistoryEntry {
  id: Id;
  listId: Id;
  name: string;
  categoryId: Id | null;
  storeId: Id | null;
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
