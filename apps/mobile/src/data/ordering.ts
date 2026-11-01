// 店舗ごとのカテゴリの順番。計算の結果を、元の表が変わるまで使い回す
import {
  groupTrips,
  learnCategoryOrder,
  masterOrder,
  type Category,
  type HistoryEntry,
  type Id,
  type Iso,
  type StoreOrder,
} from "@shopping-list/core";

export interface OrderSources {
  categories: readonly Category[];
  history: readonly HistoryEntry[];
  storeOrders: readonly StoreOrder[];
  now: Iso;
}

export class OrderCache {
  #sources: OrderSources | null = null;
  #orders = new Map<Id | null, readonly Id[]>();

  orderFor(storeId: Id | null, sources: OrderSources): readonly Id[] {
    const held = this.#sources;
    if (
      !held ||
      held.categories !== sources.categories ||
      held.history !== sources.history ||
      held.storeOrders !== sources.storeOrders
    ) {
      this.#sources = sources;
      this.#orders = new Map();
    }
    const cached = this.#orders.get(storeId);
    if (cached) return cached;
    const order =
      storeId === null
        ? masterOrder(sources.categories)
        : learnCategoryOrder({
            storeId,
            categories: sources.categories,
            trips: groupTrips(sources.history),
            manualOrder: sources.storeOrders.find((row) => row.storeId === storeId) ?? null,
            now: sources.now,
          });
    this.#orders.set(storeId, order);
    return order;
  }
}
