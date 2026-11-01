// テスト用のインメモリの実装。LocalStore の約束の見本も兼ねる。

import type { Id, Iso, Item } from "../types.ts";
import { changeKey, isTombstoned, newestVersion, rowId, rowVersion } from "./rows.ts";
import {
  RemoteError,
  type HistoryCursor,
  type ItemPart,
  type LocalChange,
  type LocalStore,
  type MutableTable,
  type PendingOp,
  type RemoteApply,
  type RemoteIndex,
  type RemoteRowRef,
  type RemoteSnapshot,
  type RemoteStore,
  type RemoteWrite,
  type RowIssue,
  type RowOf,
  type SyncTable,
  type TableRows,
} from "./types.ts";

const MUTABLE_TABLES: readonly MutableTable[] = [
  "lists",
  "categories",
  "stores",
  "items",
  "storeOrders",
];

type LocalRows = { [T in SyncTable]: Map<Id, TableRows[T]> };

export class MemoryLocalStore implements LocalStore {
  readonly rows: LocalRows = {
    lists: new Map(),
    categories: new Map(),
    stores: new Map(),
    items: new Map(),
    storeOrders: new Map(),
    history: new Map(),
  };
  #ops: PendingOp[] = [];
  #seq = 0;
  #cursor: HistoryCursor | null = null;

  async commit(changes: LocalChange[]): Promise<void> {
    for (const change of changes) {
      this.#seq += 1;
      if (change.action === "put") {
        (this.rows[change.table] as Map<Id, unknown>).set(rowId(change), change.row);
      } else {
        this.rows[change.table].delete(change.id);
      }
      this.#ops.push({ ...change, seq: this.#seq });
    }
  }

  async pendingOps(limit: number): Promise<PendingOp[]> {
    return this.#ops.slice(0, limit);
  }

  async pendingCount(): Promise<number> {
    return this.#ops.length;
  }

  async ackOps(seqs: number[]): Promise<void> {
    const acked = new Set(seqs);
    this.#ops = this.#ops.filter((op) => !acked.has(op.seq));
  }

  async historyCursor(): Promise<HistoryCursor | null> {
    return this.#cursor;
  }

  async applyRemote(input: RemoteApply): Promise<void> {
    const pending = new Set(this.#ops.map(changeKey));
    for (const table of MUTABLE_TABLES) {
      const target = this.rows[table] as Map<Id, unknown>;
      const seen = new Set<Id>(input.keep[table] ?? []);
      for (const row of input.tables[table]) {
        const id = rowId({ table, row } as RowOf);
        seen.add(id);
        if (!pending.has(`${table}\0${id}`)) target.set(id, row);
      }
      for (const id of [...target.keys()]) {
        if (!seen.has(id) && !pending.has(`${table}\0${id}`)) target.delete(id);
      }
    }
    for (const entry of input.history) this.rows.history.set(entry.id, entry);
    this.#cursor = input.historyCursor;
  }
}

// 部分の書き込み。書かない部分のセルはシートの値のまま残す
function mergeItemPart(remote: Item, written: Item, part: ItemPart): Item {
  const [checkFrom, bodyFrom] = part === "check" ? [written, remote] : [remote, written];
  const { checked, checkedAt, checkedStoreId, checkedUpdatedAt } = checkFrom;
  return { ...bodyFrom, checked, checkedAt, checkedStoreId, checkedUpdatedAt };
}

type RemoteRows = { [T in SyncTable]: TableRows[T][] };

// 配列の添字 + 1 を行の位置とする。墓石はシートの deleted_at の列の代わりに別に持つ
export class MemoryRemoteStore implements RemoteStore {
  readonly rows: RemoteRows = {
    lists: [],
    categories: [],
    stores: [],
    items: [],
    storeOrders: [],
    history: [],
  };
  // 表ごとの、行の位置から墓石の時刻へ
  readonly deletedAt: Record<MutableTable, Map<number, Iso>> = {
    lists: new Map(),
    categories: new Map(),
    stores: new Map(),
    items: new Map(),
    storeOrders: new Map(),
  };
  readonly calls = { locate: 0, write: 0, pull: 0 };
  readonly issues: RowIssue[] = [];
  offline = false;
  // 次の pull の直後、結果を返す前に呼ぶ。同期の途中の画面の操作を再現する
  afterPull: (() => Promise<void>) | null = null;
  // 次の locate の直後、結果を返す前に呼ぶ。読んでから書くまでの間の、別の端末の書き込みを再現する
  afterLocate: (() => Promise<void>) | null = null;
  // true を返す書き込みが混ざると、全体を拒否する。入力規則の違反を再現する
  rejects: ((write: RemoteWrite) => boolean) | null = null;

  #assertOnline(): void {
    if (this.offline) throw new RemoteError("offline", "つながらない");
  }

  #liveRows<T extends MutableTable>(table: T): TableRows[T][] {
    const rows = this.rows[table] as TableRows[T][];
    return rows.filter((row, i) => {
      const deletedAt = this.deletedAt[table].get(i + 1) ?? null;
      return !isTombstoned(rowVersion({ table, row } as RowOf), deletedAt);
    });
  }

  async locate(tables: MutableTable[]): Promise<RemoteIndex> {
    this.calls.locate += 1;
    this.#assertOnline();
    const index: RemoteIndex = {};
    for (const table of tables) {
      index[table] = (this.rows[table] as TableRows[MutableTable][]).map(
        (row, i): RemoteRowRef => {
          const change = { table, row } as RowOf;
          const deletedAt = this.deletedAt[table].get(i + 1) ?? null;
          const ref: RemoteRowRef = {
            id: rowId(change),
            rowNumber: i + 1,
            version: newestVersion(rowVersion(change), deletedAt),
          };
          if (change.table === "items") {
            ref.parts = {
              body: newestVersion(change.row.updatedAt, deletedAt),
              check: newestVersion(change.row.checkedUpdatedAt, deletedAt),
            };
          }
          return ref;
        },
      );
    }
    const afterLocate = this.afterLocate;
    this.afterLocate = null;
    await afterLocate?.();
    return index;
  }

  async write(writes: RemoteWrite[]): Promise<void> {
    this.calls.write += 1;
    this.#assertOnline();
    if (writes.some((write) => this.rejects?.(write))) {
      throw new RemoteError("invalid", "入力規則の違反");
    }
    for (const write of writes) {
      if (write.kind === "tombstone") {
        this.deletedAt[write.table].set(write.rowNumber, write.at);
        continue;
      }
      const rows = this.rows[write.table] as unknown[];
      if (write.kind === "insert") {
        rows.push(write.row);
      } else if (write.table === "items" && write.part !== undefined) {
        const items = this.rows.items;
        items[write.rowNumber - 1] = mergeItemPart(
          items[write.rowNumber - 1] as Item,
          write.row,
          write.part,
        );
        // deleted_at は body の側のセル
        if (write.part === "body") this.deletedAt.items.delete(write.rowNumber);
      } else {
        rows[write.rowNumber - 1] = write.row;
        // 行全体を書くので、deleted_at も空になる
        if (write.table !== "history") {
          this.deletedAt[write.table].delete(write.rowNumber);
        }
      }
    }
  }

  async pull(cursor: HistoryCursor | null): Promise<RemoteSnapshot> {
    this.calls.pull += 1;
    this.#assertOnline();
    const { history } = this.rows;
    const snapshot: RemoteSnapshot = {
      tables: {
        lists: this.#liveRows("lists"),
        categories: this.#liveRows("categories"),
        stores: this.#liveRows("stores"),
        items: this.#liveRows("items"),
        storeOrders: this.#liveRows("storeOrders"),
      },
      history: history.slice(cursor?.position ?? 0),
      historyCursor: { position: history.length, lastId: history.at(-1)?.id ?? null },
      issues: [...this.issues],
    };
    await this.afterPull?.();
    return snapshot;
  }
}
