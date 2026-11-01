// 画面の読み取り。外部のライブラリを使わず、SQLite の写しを useSyncExternalStore で読む。
// リポジトリの commit と同期の取り込みで通知が来て、変わった表の画面だけが描き直される
import { sectionItems, type Id, type ListDirection, type SyncTable, type TableRows } from "@shopping-list/core";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { SESSION_KEY } from "./repository.ts";
import { INVITE_KEY, localStore, orderForStore, OWNER_KEY, repository, SHEET_KEY, syncRunner } from "./runtime.ts";
import { activeSession } from "./shopping.ts";
import type { SheetRef } from "./spreadsheet.ts";
import type { SyncStatus } from "./syncRunner.ts";

export function useTable<T extends SyncTable>(table: T): readonly TableRows[T][] {
  const subscribe = useCallback((listener: () => void) => localStore.subscribe(table, listener), [table]);
  return useSyncExternalStore(subscribe, () => localStore.rows(table));
}

export function usePendingCount(): number {
  return useSyncExternalStore(
    (listener) => localStore.subscribe("pending", listener),
    () => localStore.pendingCountNow(),
  );
}

// 件数が変わるたびに描き直したくない画面のため、有無だけを読む
export function useHasPending(): boolean {
  return useSyncExternalStore(
    (listener) => localStore.subscribe("pending", listener),
    () => localStore.pendingCountNow() > 0,
  );
}

function useSetting(key: string): string | null {
  return useSyncExternalStore(
    (listener) => localStore.subscribe("settings", listener),
    () => localStore.setting(key),
  );
}

export function useSheet(): SheetRef | null {
  const stored = useSetting(SHEET_KEY);
  return useMemo(() => (stored === null ? null : (JSON.parse(stored) as SheetRef)), [stored]);
}

export function usePendingInvite(): string | null {
  return useSetting(INVITE_KEY);
}

export function useAccountOwner(): string | null {
  return useSetting(OWNER_KEY);
}

// シートの切り替えの通信の間は true。画面は操作を止める表示を出す
export function useWritesLocked(): boolean {
  return useSyncExternalStore(
    (listener) => localStore.subscribe("writesLocked", listener),
    localStore.writesLocked,
  );
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(syncRunner.subscribe, syncRunner.status);
}

export function useListItems(listId: Id) {
  const items = useTable("items");
  return useMemo(() => items.filter((item) => item.listId === listId), [items, listId]);
}

// 今の買い物の状態。時間が空いたものは無かったことにする
export function useShopping() {
  const stored = useSetting(SESSION_KEY);
  // stored が変わったときだけ読み直す
  return useMemo(() => (stored === null ? null : activeSession(repository.session(), new Date().toISOString())), [stored]);
}

// 店舗のカテゴリの順番。元の表が変わったときだけ計算し直す
export function useOrder(storeId: Id | null): readonly Id[] {
  const categories = useTable("categories");
  const history = useTable("history");
  const storeOrders = useTable("storeOrders");
  return useMemo(() => orderForStore(storeId), [categories, history, storeOrders, storeId]);
}

export function useSections(listId: Id, storeId: Id | null, direction: ListDirection) {
  const items = useListItems(listId);
  const order = useOrder(storeId);
  return useMemo(() => sectionItems({ items, order, direction }), [items, order, direction]);
}
