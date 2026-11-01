// 画面からの書き込み。すべて同期で SQLite に入れ、送信は同期が裏で行う
import {
  normalizeItemName,
  type Category,
  type CategoryResolution,
  type Id,
  type Iso,
  type Item,
  type ListDirection,
  type LocalChange,
  type Store,
} from "@shopping-list/core";

import type { SqliteLocalStore } from "./localStore.ts";
import { activeSession, reviewDirection, startSession, withManualDirection, type ShoppingSession } from "./shopping.ts";
import { finishedTripChanges } from "./trips.ts";

export const SESSION_KEY = "shoppingSession";

export interface RepositoryDeps {
  store: SqliteLocalStore;
  newId: () => Id;
  now: () => Iso;
  // 店舗のカテゴリの順番(向きの判定に使う)
  orderForStore: (storeId: Id | null) => readonly Id[];
}

export type ItemPatch = Partial<Pick<Item, "name" | "categoryId" | "memo">>;

function nextSort(rows: readonly { sort: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.sort), 0) + 1;
}

export class Repository {
  readonly #store: SqliteLocalStore;
  readonly #newId: () => Id;
  readonly #now: () => Iso;
  readonly #orderForStore: (storeId: Id | null) => readonly Id[];

  constructor(deps: RepositoryDeps) {
    this.#store = deps.store;
    this.#newId = deps.newId;
    this.#now = deps.now;
    this.#orderForStore = deps.orderForStore;
  }

  // --- リスト ---

  addList(name: string): Id {
    const id = this.#newId();
    const sort = nextSort(this.#store.rows("lists"));
    this.#store.commitNow([{ action: "put", table: "lists", row: { id, name: name.trim(), sort } }]);
    return id;
  }

  renameList(id: Id, name: string): void {
    const list = this.#store.rows("lists").find((row) => row.id === id);
    if (list) this.#store.commitNow([{ action: "put", table: "lists", row: { ...list, name: name.trim() } }]);
  }

  // 品目も一緒に消す。History は足すだけなので残す
  deleteList(id: Id): void {
    const at = this.#now();
    const items = this.#store.rows("items").filter((item) => item.listId === id);
    this.#store.commitNow([
      ...items.map((item): LocalChange => ({ action: "delete", table: "items", id: item.id, at })),
      { action: "delete", table: "lists", id, at },
    ]);
  }

  // --- 品目 ---

  // 同じ名前がまだ買っていない状態でリストにあれば足さず、null を返す
  addItem(listId: Id, name: string, category: CategoryResolution): Item | null {
    const trimmed = name.trim();
    const key = normalizeItemName(trimmed);
    if (key === "") return null;
    const exists = this.#store
      .rows("items")
      .some((item) => item.listId === listId && !item.checked && normalizeItemName(item.name) === key);
    if (exists) return null;
    const item: Item = {
      id: this.#newId(),
      listId,
      name: trimmed,
      categoryId: category.categoryId,
      categorySource: category.categorySource,
      memo: "",
      checked: false,
      checkedAt: null,
      checkedStoreId: null,
      updatedAt: this.#now(),
    };
    this.#store.commitNow([{ action: "put", table: "items", row: item }]);
    return item;
  }

  // カテゴリを変えたら、利用者の決定として残す(次から lookupCategory がいちばん強く見る)
  updateItem(id: Id, patch: ItemPatch): void {
    const item = this.#item(id);
    if (!item) return;
    const next: Item = { ...item, ...patch, updatedAt: this.#now() };
    if (patch.categoryId !== undefined && patch.categoryId !== item.categoryId) {
      next.categorySource = patch.categoryId === null ? null : "user";
    }
    this.#store.commitNow([{ action: "put", table: "items", row: next }]);
  }

  deleteItem(id: Id): void {
    this.#store.commitNow([{ action: "delete", table: "items", id, at: this.#now() }]);
  }

  #item(id: Id): Item | undefined {
    return this.#store.rows("items").find((item) => item.id === id);
  }

  // チェックする。トリップの最初のチェックなら true を返す(画面が店舗を聞く)
  checkItem(id: Id): boolean {
    const item = this.#item(id);
    if (!item || item.checked) return false;
    const now = this.#now();
    const current = this.currentSession();
    const session = { ...(current ?? startSession(now)), touchedAt: now };
    const checked: Item = { ...item, checked: true, checkedAt: now, checkedStoreId: session.storeId, updatedAt: now };
    this.#store.commitNow([{ action: "put", table: "items", row: checked }]);
    this.#saveSession(reviewDirection(session, this.#orderForStore(session.storeId), this.#store.rows("items")));
    return current === null;
  }

  // チェックを外す。そのチェックの記録も消える(学習に使わない)
  uncheckItem(id: Id): void {
    const item = this.#item(id);
    if (!item?.checked) return;
    const row: Item = { ...item, checked: false, checkedAt: null, checkedStoreId: null, updatedAt: this.#now() };
    this.#store.commitNow([{ action: "put", table: "items", row }]);
  }

  // --- 買い物の状態 ---

  session(): ShoppingSession | null {
    const stored = this.#store.setting(SESSION_KEY);
    return stored === null ? null : (JSON.parse(stored) as ShoppingSession);
  }

  currentSession(): ShoppingSession | null {
    return activeSession(this.session(), this.#now());
  }

  #saveSession(session: ShoppingSession): void {
    this.#store.setSetting(SESSION_KEY, JSON.stringify(session));
  }

  // 今の店舗を決める。このトリップのチェックは新しい店舗へ付け替える(選び直しを正しい記録にする)
  selectStore(storeId: Id): void {
    const now = this.#now();
    const session = this.currentSession() ?? startSession(now);
    const startedAt = Date.parse(session.startedAt);
    const moved = this.#store
      .rows("items")
      .filter(
        (item) =>
          item.checked &&
          item.checkedAt !== null &&
          Date.parse(item.checkedAt) >= startedAt &&
          item.checkedStoreId === session.storeId,
      )
      .map((item): LocalChange => ({ action: "put", table: "items", row: { ...item, checkedStoreId: storeId, updatedAt: now } }));
    this.#store.commitNow(moved);
    const next = { ...session, storeId, touchedAt: now };
    this.#saveSession(reviewDirection(next, this.#orderForStore(storeId), this.#store.rows("items")));
  }

  setDirection(direction: ListDirection): void {
    this.#saveSession(withManualDirection(this.currentSession() ?? startSession(this.#now()), direction));
  }

  // 終わったトリップの品目を History へ移す。移した品目の数を返す
  finishTrips(): number {
    const changes = finishedTripChanges(this.#store.rows("items"), this.#now());
    this.#store.commitNow(changes);
    return changes.length / 2;
  }

  // --- 店舗 ---

  addStore(name: string, position: { lat: number; lng: number } | null): Id {
    const store: Store = {
      id: this.#newId(),
      name: name.trim(),
      lat: position?.lat ?? null,
      lng: position?.lng ?? null,
      createdAt: this.#now(),
    };
    this.#store.commitNow([{ action: "put", table: "stores", row: store }]);
    return store.id;
  }

  updateStore(id: Id, patch: Partial<Pick<Store, "name" | "lat" | "lng">>): void {
    const store = this.#store.rows("stores").find((row) => row.id === id);
    if (store) this.#store.commitNow([{ action: "put", table: "stores", row: { ...store, ...patch } }]);
  }

  // 品目の参照と手の順番も外す(シートのプルダウンの参照先が無くならないように)。History は残す
  deleteStore(id: Id): void {
    const at = this.#now();
    const items = this.#store.rows("items").filter((item) => item.checkedStoreId === id);
    const hasOrder = this.#store.rows("storeOrders").some((row) => row.storeId === id);
    const order: LocalChange[] = hasOrder ? [{ action: "delete", table: "storeOrders", id, at }] : [];
    this.#store.commitNow([
      ...items.map((item): LocalChange => ({ action: "put", table: "items", row: { ...item, checkedStoreId: null, updatedAt: at } })),
      ...order,
      { action: "delete", table: "stores", id, at },
    ]);
    const session = this.session();
    if (session?.storeId === id) this.#saveSession({ ...session, storeId: null });
  }

  saveStoreOrder(storeId: Id, categoryIds: Id[]): void {
    this.#store.commitNow([{ action: "put", table: "storeOrders", row: { storeId, categoryIds, editedAt: this.#now() } }]);
  }

  // --- カテゴリ ---

  addCategory(name: string): Id {
    const id = this.#newId();
    const sort = nextSort(this.#store.rows("categories"));
    this.#store.commitNow([{ action: "put", table: "categories", row: { id, name: name.trim(), sort } }]);
    return id;
  }

  renameCategory(id: Id, name: string): void {
    const category = this.#store.rows("categories").find((row) => row.id === id);
    if (category) this.#store.commitNow([{ action: "put", table: "categories", row: { ...category, name: name.trim() } }]);
  }

  // 隣と sort を入れ替える
  moveCategory(id: Id, offset: -1 | 1): void {
    const categories: readonly Category[] = this.#store.rows("categories");
    const index = categories.findIndex((row) => row.id === id);
    const other = categories[index + offset];
    if (index < 0 || !other) return;
    const current = categories[index];
    this.#store.commitNow([
      { action: "put", table: "categories", row: { ...current, sort: other.sort } },
      { action: "put", table: "categories", row: { ...other, sort: current.sort } },
    ]);
  }

  // 品目は未分類に戻す(シートのプルダウンの参照先が無くならないように)
  deleteCategory(id: Id): void {
    const at = this.#now();
    const items = this.#store.rows("items").filter((item) => item.categoryId === id);
    this.#store.commitNow([
      ...items.map(
        (item): LocalChange => ({
          action: "put",
          table: "items",
          row: { ...item, categoryId: null, categorySource: null, updatedAt: at },
        }),
      ),
      { action: "delete", table: "categories", id, at },
    ]);
  }
}
