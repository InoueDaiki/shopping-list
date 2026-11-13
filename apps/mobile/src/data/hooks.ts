// 画面の読み取り。外部のライブラリを使わず、SQLite の写しを useSyncExternalStore で読む。
// リポジトリの commit と同期の取り込みで通知が来て、変わった表の画面だけが描き直される
import { categoriesOfList, sectionItems, withoutForgotten, type Id, type ListDirection, type SyncTable, type TableRows } from "@shopping-list/core";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { SESSION_KEY } from "./repository.ts";
import { INVITE_KEY, localStore, orderForStore, OWNER_KEY, repository, SHEET_KEY, storedHistory, syncRunner } from "./runtime.ts";
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

// どのリストにも属さない品目(野良品目)。リスト一覧の「未整理」に出す
export function useStrayItems() {
  const items = useTable("items");
  return useMemo(() => items.filter((item) => item.listId === null), [items]);
}

// そのリストのカテゴリ。カテゴリのマスタはリストごとに持つ
export function useListCategories(listId: Id) {
  const categories = useTable("categories");
  return useMemo(() => categoriesOfList(categories, listId), [categories, listId]);
}

// 履歴(storedHistory と同じ)。共通だったころのカテゴリの ID を、そのリストのカテゴリの ID に読み替えてある。
// 履歴のカテゴリを見るところは、useTable("history") ではなくこれを使う
export function useHistory() {
  const history = useTable("history");
  const categories = useTable("categories");
  return useMemo(() => storedHistory(), [history, categories]);
}

// 忘れた品目名の分を除いた履歴(rememberedHistory と同じ)。候補とよく使う品目と品目の管理に使う
export function useRememberedHistory() {
  const history = useHistory();
  const forgotten = useTable("forgottenItems");
  return useMemo(() => withoutForgotten(history, forgotten), [history, forgotten]);
}

// このリストの今の買い物の状態。時間が空いたものと、別のリストのものは無かったことにする
export function useShopping(listId: Id) {
  const stored = useSetting(SESSION_KEY);
  // stored が変わったときだけ読み直す
  return useMemo(() => (stored === null ? null : repository.currentSession(listId)), [stored, listId]);
}

// 店舗のカテゴリの順番。店舗のリストのカテゴリだけが並ぶ。listId は開いているリストで、
// リストの決まっていない店舗と、店舗が決まっていないときに使う。元の表が変わったときだけ計算し直す
export function useOrder(storeId: Id | null, listId: Id | null): readonly Id[] {
  const categories = useTable("categories");
  const stores = useTable("stores");
  const history = useTable("history");
  const storeOrders = useTable("storeOrders");
  return useMemo(() => orderForStore(storeId, listId), [categories, stores, history, storeOrders, storeId, listId]);
}

// hiddenId は消す途中(取り消せる間)の品目で、一覧に出さない
export function useSections(listId: Id, storeId: Id | null, direction: ListDirection, hiddenId: Id | null = null) {
  const listItems = useListItems(listId);
  const items = useMemo(() => (hiddenId === null ? listItems : listItems.filter((item) => item.id !== hiddenId)), [listItems, hiddenId]);
  const order = useOrder(storeId, listId);
  return useMemo(() => sectionItems({ items, order, direction }), [items, order, direction]);
}
