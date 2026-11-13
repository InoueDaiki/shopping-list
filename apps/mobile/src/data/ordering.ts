// 店舗ごとのカテゴリの順番。計算の結果を、元の表が変わるまで使い回す
import {
  categoriesOfList,
  groupTrips,
  hasLearnedOrder,
  learnCategoryOrder,
  masterOrder,
  rehomeCategoryIds,
  type Category,
  type HistoryEntry,
  type Id,
  type Iso,
  type Store,
  type StoreOrder,
} from "@shopping-list/core";

export interface OrderSources {
  // すべてのリストのカテゴリ。順番に出すのは、店舗のリストのカテゴリだけ
  categories: readonly Category[];
  stores: readonly Store[];
  // 共通だったころのカテゴリの ID を読み替えた履歴(rehomeHistory)
  history: readonly HistoryEntry[];
  storeOrders: readonly StoreOrder[];
  now: Iso;
}

export class OrderCache {
  #sources: OrderSources | null = null;
  #orders = new Map<string, readonly Id[]>();
  #learned = new Map<Id, boolean>();

  #refresh(sources: OrderSources): void {
    const held = this.#sources;
    if (
      !held ||
      held.categories !== sources.categories ||
      held.stores !== sources.stores ||
      held.history !== sources.history ||
      held.storeOrders !== sources.storeOrders
    ) {
      this.#sources = sources;
      this.#orders = new Map();
      this.#learned = new Map();
    }
  }

  // 学んだ順番。学んでいなければ null(チェックのたびに呼ぶので、結果を使い回す)
  learnedOrderFor(storeId: Id, listId: Id | null, sources: OrderSources): readonly Id[] | null {
    this.#refresh(sources);
    let learned = this.#learned.get(storeId);
    if (learned === undefined) {
      learned = hasLearnedOrder({
        storeId,
        trips: groupTrips(sources.history),
        manualOrder: sources.storeOrders.find((row) => row.storeId === storeId) ?? null,
        now: sources.now,
      });
      this.#learned.set(storeId, learned);
    }
    return learned ? this.orderFor(storeId, listId, sources) : null;
  }

  // 店舗の順番。相手にするのは店舗のリストのカテゴリだけで、リストの決まっていない店舗と、
  // 店舗が決まっていないとき(マスタの順)は、開いているリスト(listId)のカテゴリにする
  orderFor(storeId: Id | null, listId: Id | null, sources: OrderSources): readonly Id[] {
    this.#refresh(sources);
    const store = storeId === null ? undefined : sources.stores.find((row) => row.id === storeId);
    const ownerId = store?.listId ?? listId;
    const key = `${storeId ?? ""}\u0000${ownerId ?? ""}`;
    const cached = this.#orders.get(key);
    if (cached) return cached;
    const categories = categoriesOfList(sources.categories, ownerId);
    const manual = storeId === null ? undefined : sources.storeOrders.find((row) => row.storeId === storeId);
    const order =
      storeId === null
        ? masterOrder(categories)
        : learnCategoryOrder({
            storeId,
            categories,
            trips: groupTrips(sources.history),
            // 分ける前に並べた手の順番は、共通だったころの ID のまま残っていることがある
            manualOrder:
              manual && ownerId !== null
                ? { ...manual, categoryIds: [...rehomeCategoryIds(manual.categoryIds, ownerId, sources.categories)] }
                : (manual ?? null),
            now: sources.now,
          });
    this.#orders.set(key, order);
    return order;
  }
}
