// 同期の型。バックエンドにも端末の保存先にも依らない。
// LocalStore は SQLite、RemoteStore はスプレッドシートが実装する。

import type {
  Category,
  HistoryEntry,
  Id,
  Iso,
  Item,
  ShoppingList,
  Store,
  StoreOrder,
} from "../types.ts";

export interface TableRows {
  lists: ShoppingList;
  categories: Category;
  stores: Store;
  items: Item;
  storeOrders: StoreOrder;
  history: HistoryEntry;
}

export type SyncTable = keyof TableRows;
// History は足すだけなので、消す操作を持たない
export type MutableTable = Exclude<SyncTable, "history">;

// 表と行の組。表と行の型がずれないよう、表ごとの和にする
export type RowOf = {
  [T in SyncTable]: { table: T; row: TableRows[T] };
}[SyncTable];

// 画面からの変更。delete の at は消した時刻で、後勝ちの比較に使う
export type LocalChange =
  | (RowOf & { action: "put" })
  | { action: "delete"; table: MutableTable; id: Id; at: Iso };

// 送信待ちの列の1件。seq は端末の中で単調に増える
export type PendingOp = LocalChange & { seq: number };

// History の読み終えた位置。position は次に読む位置で、lastId はその1つ前の行の ID。
// 位置の意味は RemoteStore が決める。LocalStore はそのまま保存して返す
export interface HistoryCursor {
  position: number;
  lastId: Id | null;
}

// 取り込めなかった行。捨てずに報告し、画面で知らせる
export interface RowIssue {
  table: SyncTable;
  // リモートでの行の位置
  row: number;
  // ID が読めないときは null
  id: Id | null;
  problems: { column: string; message: string }[];
}

// 書く前に調べた、リモートの行の位置と版。位置はこの読み取りの時点のもの
export interface RemoteRowRef {
  id: Id;
  rowNumber: number;
  // 版の列が無い表、または読めないときは null
  version: Iso | null;
}

export type RemoteIndex = Partial<Record<MutableTable, RemoteRowRef[]>>;

export type RemoteWrite =
  | (RowOf & { kind: "insert" })
  | (RowOf & { kind: "update"; rowNumber: number })
  | { kind: "delete"; table: MutableTable; rowNumber: number };

export type TableSnapshot = { [T in MutableTable]: TableRows[T][] };

export interface RemoteSnapshot {
  tables: TableSnapshot;
  // cursor より後ろの行。読み直しになったときは前の行も含む(ID で重ねて保存する)
  history: HistoryEntry[];
  historyCursor: HistoryCursor;
  issues: RowIssue[];
}

export interface RemoteStore {
  // ID と版の列を読む。読み取り1回
  locate(tables: MutableTable[]): Promise<RemoteIndex>;
  // 順に適用する。全部反映されるか、何も反映されないか。書き込み1回
  write(writes: RemoteWrite[]): Promise<void>;
  // 全部の表と History の続きを読む。読み取り1回(History の読み直しのときだけ2回)
  pull(cursor: HistoryCursor | null): Promise<RemoteSnapshot>;
}

export type RemoteErrorKind =
  // つながらない。送信待ちは残し、次に送る
  | "offline"
  // ログインし直しが要る
  | "auth"
  // シートへの権限が無い
  | "forbidden"
  // シートが見つからない
  | "notFound"
  // バックオフのあとも回数の上限に当たる
  | "rateLimited"
  // バックオフのあともサーバーの失敗が続く
  | "server"
  // スキーマの版やシートの形が合わない
  | "schema"
  // 要求を拒否された(入力規則の違反など)
  | "invalid";

export class RemoteError extends Error {
  readonly kind: RemoteErrorKind;

  constructor(kind: RemoteErrorKind, message: string) {
    super(message);
    this.name = "RemoteError";
    this.kind = kind;
  }
}

// LocalStore.applyRemote の入力
export interface RemoteApply extends Pick<
  RemoteSnapshot,
  "tables" | "history" | "historyCursor"
> {
  // 不正な行として取り込めなかった ID。シートには残っているので消さない
  keep: Partial<Record<MutableTable, Id[]>>;
}

export interface LocalStore {
  // 行の反映と送信待ちへの追加を、1つのトランザクションで行う。画面の書き込みはこれだけを通す
  commit(changes: LocalChange[]): Promise<void>;
  // seq の古い順に返す
  pendingOps(limit: number): Promise<PendingOp[]>;
  pendingCount(): Promise<number>;
  // 指定の seq だけを消す。送信中に足された操作は残す
  ackOps(seqs: number[]): Promise<void>;
  historyCursor(): Promise<HistoryCursor | null>;
  // リモートの内容を、1つのトランザクションで写す。次を守る。
  // - 送信待ちのある (表, ID) の行は変えない
  // - tables に無く、keep にも送信待ちにも無い行は消す
  // - history は ID で重ねて保存し、ローカルからは消さない
  // - historyCursor を保存する
  applyRemote(input: RemoteApply): Promise<void>;
}
