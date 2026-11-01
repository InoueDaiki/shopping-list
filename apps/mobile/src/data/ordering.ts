// 店舗ごとのカテゴリの順番。計算の結果を、元の表が変わるまで使い回す
import {
  groupTrips,
  hasLearnedOrder,
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
  #learned = new Map<Id, boolean>();

  #refresh(sources: OrderSources): void {
    const held = this.#sources;
    if (
      !held ||
      held.categories !== sources.categories ||
      held.history !== sources.history ||
      held.storeOrders !== sources.storeOrders
    ) {
      this.#sources = sources;
      this.#orders = new Map();
      this.#learned = new Map();
    }
  }

  // 学んだ順番。学んでいなければ null(チェックのたびに呼ぶので、結果を使い回す)
  learnedOrderFor(storeId: Id, sources: OrderSources): readonly Id[] | null {
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
    return learned ? this.orderFor(storeId, sources) : null;
  }

  orderFor(storeId: Id | null, sources: OrderSources): readonly Id[] {
    this.#refresh(sources);
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
