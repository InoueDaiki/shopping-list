// 画面からの書き込み。すべて同期で SQLite に入れ、送信は同期が裏で行う
import {
  normalizeItemName,
  storesForList,
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
import {
  activeSession,
  isStoreCorrection,
  reviewDirection,
  sessionChecks,
  sessionOfList,
  startSession,
  withManualDirection,
  type ShoppingSession,
} from "./shopping.ts";
import { finishedTripChanges } from "./trips.ts";

export const SESSION_KEY = "shoppingSession";

export interface RepositoryDeps {
  store: SqliteLocalStore;
  newId: () => Id;
  now: () => Iso;
  // 店舗の学んだ順番(向きの判定に使う)。店舗が無いときと学んでいないときは null
  learnedOrder: (storeId: Id | null) => readonly Id[] | null;
}

export type ItemPatch = Partial<Pick<Item, "name" | "categoryId" | "memo">>;

function nextSort(rows: readonly { sort: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.sort), 0) + 1;
}

export class Repository {
  readonly #store: SqliteLocalStore;
  readonly #newId: () => Id;
  readonly #now: () => Iso;
  readonly #learnedOrder: (storeId: Id | null) => readonly Id[] | null;

  constructor(deps: RepositoryDeps) {
    this.#store = deps.store;
    this.#newId = deps.newId;
    this.#now = deps.now;
    this.#learnedOrder = deps.learnedOrder;
  }

  // --- リスト ---

  addList(name: string): Id {
    const id = this.#newId();
    const sort = nextSort(this.#store.rows("lists"));
    this.#store.commitNow([{ action: "put", table: "lists", row: { id, name: name.trim(), sort, updatedAt: this.#now() } }]);
    return id;
  }

  renameList(id: Id, name: string): void {
    const list = this.#store.rows("lists").find((row) => row.id === id);
    if (list) this.#store.commitNow([{ action: "put", table: "lists", row: { ...list, name: name.trim(), updatedAt: this.#now() } }]);
  }

  // 品目と、そのリストの店舗と手の順番も一緒に消す。History は足すだけなので残す
  deleteList(id: Id): void {
    const at = this.#now();
    const stores = new Set(this.#store.rows("stores").filter((store) => store.listId === id).map((store) => store.id));
    const items = this.#store.rows("items").filter((item) => item.listId === id);
    this.#store.commitNow([
      ...this.#storeRemoval(stores, at),
      ...items.map((item): LocalChange => ({ action: "delete", table: "items", id: item.id, at })),
      { action: "delete", table: "lists", id, at },
    ]);
    this.#forgetStores(stores);
    if (this.session()?.listId === id) this.#store.setSetting(SESSION_KEY, null);
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
    const at = this.#now();
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
      checkedUpdatedAt: at,
      updatedAt: at,
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

  // 推定の結果を入れる。推定の途中で利用者が決めていたら上書きしない
  applyInferredCategory(id: Id, categoryId: Id): void {
    const item = this.#item(id);
    if (!item || item.categoryId !== null) return;
    this.#store.commitNow([{ action: "put", table: "items", row: { ...item, categoryId, categorySource: "inferred", updatedAt: this.#now() } }]);
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
    const current = this.currentSession(item.listId);
    // 向きの切り替えだけで始まった買い物は、まだ店舗を聞いていない。スキップの後は聞き直さない
    const first = current === null || (current.storeId === null && !this.#hasChecks(current));
    const session = { ...(current ?? startSession(item.listId, now)), touchedAt: now };
    const checked: Item = { ...item, checked: true, checkedAt: now, checkedStoreId: session.storeId, checkedUpdatedAt: now };
    this.#store.commitNow([{ action: "put", table: "items", row: checked }]);
    this.#saveSession(reviewDirection(session, this.#learnedOrder(session.storeId), this.#store.rows("items")));
    return first;
  }

  #hasChecks(session: ShoppingSession): boolean {
    const startedAt = Date.parse(session.startedAt);
    return this.#store
      .rows("items")
      .some((item) => item.listId === session.listId && item.checked && item.checkedAt !== null && Date.parse(item.checkedAt) >= startedAt);
  }

  // チェックを外す。そのチェックの記録も消える(学習に使わない)
  uncheckItem(id: Id): void {
    const item = this.#item(id);
    if (!item?.checked) return;
    const row: Item = { ...item, checked: false, checkedAt: null, checkedStoreId: null, checkedUpdatedAt: this.#now() };
    this.#store.commitNow([{ action: "put", table: "items", row }]);
  }

  // --- 買い物の状態 ---

  // listId の無い保存済みの状態は、どのリストの買い物か分からないので無視する
  session(): ShoppingSession | null {
    const stored = this.#store.setting(SESSION_KEY);
    const session = stored === null ? null : (JSON.parse(stored) as Partial<ShoppingSession>);
    return typeof session?.listId === "string" ? (session as ShoppingSession) : null;
  }

  currentSession(listId: Id): ShoppingSession | null {
    return sessionOfList(this.session(), listId, this.#now());
  }

  // どれかのリストで買い物をしているか
  isShopping(): boolean {
    return activeSession(this.session(), this.#now()) !== null;
  }

  #saveSession(session: ShoppingSession): void {
    this.#store.setSetting(SESSION_KEY, JSON.stringify(session));
  }

  // 今の店舗を決める。最後のチェックから5分以内は選び直しとして、このトリップのチェックを
  // 新しい店舗へ付け替える。過ぎていれば前のチェックはそのままで、以後を新しいトリップにする。
  // リストの決まっていない店舗は、選んだリストに属させる
  selectStore(listId: Id, storeId: Id): void {
    const now = this.#now();
    this.#adoptStore(storeId, listId);
    const session = this.currentSession(listId) ?? startSession(listId, now);
    if (session.storeId === storeId) {
      this.#saveSession({ ...session, touchedAt: now });
      return;
    }
    const checks = sessionChecks(this.#store.rows("items"), session);
    if (checks.length > 0 && !isStoreCorrection(checks, now)) {
      this.#saveSession(startSession(listId, now, storeId));
      return;
    }
    this.#store.commitNow(
      checks.map((item): LocalChange => ({ action: "put", table: "items", row: { ...item, checkedStoreId: storeId, checkedUpdatedAt: now } })),
    );
    const next = { ...session, storeId, touchedAt: now };
    this.#saveSession(reviewDirection(next, this.#learnedOrder(storeId), this.#store.rows("items")));
  }

  setDirection(listId: Id, direction: ListDirection): void {
    this.#saveSession(withManualDirection(this.currentSession(listId) ?? startSession(listId, this.#now()), direction));
  }

  // 終わったトリップの品目を History へ移す。移した品目の数を返す
  finishTrips(): number {
    const changes = finishedTripChanges(this.#store.rows("items"), this.#now());
    this.#store.commitNow(changes);
    return changes.length / 2;
  }

  // リストの無い品目を墓石にする。リストを消す前にほかの端末が足した分は、消した端末からは
  // 見えないので、同期のたびに片付ける。消した品目の数を返す
  removeOrphanItems(): number {
    const lists = new Set(this.#store.rows("lists").map((list) => list.id));
    const at = this.#now();
    const changes = this.#store
      .rows("items")
      .filter((item) => !lists.has(item.listId))
      .map((item): LocalChange => ({ action: "delete", table: "items", id: item.id, at }));
    this.#store.commitNow(changes);
    return changes.length;
  }

  // リストの無い店舗を手の順番ごと墓石にする。リストを消す前にほかの端末が足した分は、
  // 消した端末からは見えないので、同期のたびに片付ける。消した店舗の数を返す
  removeOrphanStores(): number {
    const lists = new Set(this.#store.rows("lists").map((list) => list.id));
    const orphans = new Set(
      this.#store
        .rows("stores")
        .filter((store) => store.listId !== null && !lists.has(store.listId))
        .map((store) => store.id),
    );
    this.#store.commitNow(this.#storeRemoval(orphans, this.#now()));
    this.#forgetStores(orphans);
    return orphans.size;
  }

  // リストの決まっていない店舗を、チェックの記録から最後に使ったリストへ属させる。
  // 消えたリストの記録は見ない。埋めた店舗の数を返す
  assignStoreLists(): number {
    const unassigned = this.#store.rows("stores").filter((store) => store.listId === null);
    if (unassigned.length === 0) return 0;
    const lists = new Set(this.#store.rows("lists").map((list) => list.id));
    const lastUsed = new Map<Id, { listId: Id; at: number }>();
    const note = (storeId: Id | null, listId: Id, checkedAt: Iso | null) => {
      if (storeId === null || checkedAt === null || !lists.has(listId)) return;
      const at = Date.parse(checkedAt);
      if (at > (lastUsed.get(storeId)?.at ?? -Infinity)) lastUsed.set(storeId, { listId, at });
    };
    for (const row of this.#store.rows("history")) note(row.storeId, row.listId, row.checkedAt);
    for (const row of this.#store.rows("items")) note(row.checkedStoreId, row.listId, row.checkedAt);
    const updatedAt = this.#now();
    const changes = unassigned.flatMap((store): LocalChange[] => {
      const used = lastUsed.get(store.id);
      return used ? [{ action: "put", table: "stores", row: { ...store, listId: used.listId, updatedAt } }] : [];
    });
    this.#store.commitNow(changes);
    return changes.length;
  }

  // --- 店舗 ---

  // リストの中で同じ名前(normalizeItemName で同じ)の店舗を探す。別のリストの店舗は別の店舗。
  // リストの決まっていない店舗も、このリストで選べるので探す
  findStore(listId: Id, name: string): Store | undefined {
    const key = normalizeItemName(name);
    const matches = storesForList(this.#store.rows("stores"), listId).filter((row) => normalizeItemName(row.name) === key);
    return matches.find((row) => row.listId === listId) ?? matches[0];
  }

  #adoptStore(storeId: Id, listId: Id): void {
    const store = this.#store.rows("stores").find((row) => row.id === storeId);
    if (store?.listId === null) this.#store.commitNow([{ action: "put", table: "stores", row: { ...store, listId, updatedAt: this.#now() } }]);
  }

  // リストに同じ名前の店舗があれば足さず、その ID を返す
  addStore(listId: Id, name: string, position: { lat: number; lng: number } | null): Id {
    const existing = this.findStore(listId, name);
    if (existing) {
      this.#adoptStore(existing.id, listId);
      return existing.id;
    }
    const store: Store = {
      id: this.#newId(),
      name: name.trim(),
      lat: position?.lat ?? null,
      lng: position?.lng ?? null,
      createdAt: this.#now(),
      updatedAt: this.#now(),
      listId,
    };
    this.#store.commitNow([{ action: "put", table: "stores", row: store }]);
    return store.id;
  }

  updateStore(id: Id, patch: Partial<Pick<Store, "name" | "lat" | "lng" | "listId">>): void {
    const store = this.#store.rows("stores").find((row) => row.id === id);
    if (!store) return;
    this.#store.commitNow([{ action: "put", table: "stores", row: { ...store, ...patch, updatedAt: this.#now() } }]);
    // 別のリストへ移した店舗を、前のリストの買い物に残さない
    const session = this.session();
    if (patch.listId && session?.storeId === id && session.listId !== patch.listId) this.#forgetStores(new Set([id]));
  }

  deleteStore(id: Id): void {
    const stores = new Set([id]);
    this.#store.commitNow(this.#storeRemoval(stores, this.#now()));
    this.#forgetStores(stores);
  }

  // 店舗を消す変更。品目の参照と手の順番も外す(シートのプルダウンの参照先が無くならないように)。
  // History は残す
  #storeRemoval(stores: ReadonlySet<Id>, at: Iso): LocalChange[] {
    const items = this.#store.rows("items").filter((item) => item.checkedStoreId !== null && stores.has(item.checkedStoreId));
    const orders = this.#store.rows("storeOrders").filter((row) => stores.has(row.storeId));
    return [
      ...items.map((item): LocalChange => ({ action: "put", table: "items", row: { ...item, checkedStoreId: null, checkedUpdatedAt: at } })),
      ...orders.map((row): LocalChange => ({ action: "delete", table: "storeOrders", id: row.storeId, at })),
      ...[...stores].map((id): LocalChange => ({ action: "delete", table: "stores", id, at })),
    ];
  }

  #forgetStores(stores: ReadonlySet<Id>): void {
    const session = this.session();
    if (session?.storeId && stores.has(session.storeId)) this.#saveSession({ ...session, storeId: null });
  }

  saveStoreOrder(storeId: Id, categoryIds: Id[]): void {
    this.#store.commitNow([{ action: "put", table: "storeOrders", row: { storeId, categoryIds, editedAt: this.#now() } }]);
  }

  // --- カテゴリ ---

  addCategory(name: string): Id {
    const id = this.#newId();
    const sort = nextSort(this.#store.rows("categories"));
    this.#store.commitNow([{ action: "put", table: "categories", row: { id, name: name.trim(), sort, updatedAt: this.#now() } }]);
    return id;
  }

  renameCategory(id: Id, name: string): void {
    const category = this.#store.rows("categories").find((row) => row.id === id);
    if (category) this.#store.commitNow([{ action: "put", table: "categories", row: { ...category, name: name.trim(), updatedAt: this.#now() } }]);
  }

  // 隣と sort を入れ替える
  moveCategory(id: Id, offset: -1 | 1): void {
    const categories: readonly Category[] = this.#store.rows("categories");
    const index = categories.findIndex((row) => row.id === id);
    const other = categories[index + offset];
    if (index < 0 || !other) return;
    const reordered = [...categories];
    reordered[index] = other;
    reordered[index + offset] = categories[index];
    // 2台が同時に足すと sort が重なる。入れ替えても動かないので、そのときは振り直す
    const sorts = categories.map((row) => row.sort);
    const sortAt = (position: number) => (new Set(sorts).size === sorts.length ? sorts[position] : position + 1);
    const updatedAt = this.#now();
    this.#store.commitNow(
      reordered.flatMap((row, position): LocalChange[] =>
        row.sort === sortAt(position) ? [] : [{ action: "put", table: "categories", row: { ...row, sort: sortAt(position), updatedAt } }],
      ),
    );
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
