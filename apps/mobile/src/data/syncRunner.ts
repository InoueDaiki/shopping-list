// 同期をいつ動かすかを決める。起動時、前面に来たとき、買い物中は30秒ごと、書き込みの少し後。
// 結果は画面が読める状態にまとめる
import { RemoteError, type RemoteErrorKind, type RowIssue, type SyncResult } from "@shopping-list/core";

export const SHOPPING_SYNC_INTERVAL_MS = 30_000;
// 続けて書いても1回の送信にまとめる
export const WRITE_SYNC_DELAY_MS = 3_000;
// 回数の上限で残したときに、もう一度試すまでの間
export const DEFERRED_SYNC_DELAY_MS = 20_000;

export interface SyncStatus {
  running: boolean;
  lastStatus: SyncResult["status"] | null;
  errorKind: RemoteErrorKind | "unknown" | null;
  issues: readonly RowIssue[];
  lastSyncedAt: number | null;
}

export interface SyncRunnerDeps {
  sync: () => Promise<SyncResult>;
  // 同期が終わるたびに呼ぶ(トリップの片付け)
  afterSync?: () => void;
  // 送信待ちの数。同期の途中で足された分を送り直すのに使う
  pendingCount: () => number;
  now?: () => number;
}

const INITIAL: SyncStatus = { running: false, lastStatus: null, errorKind: null, issues: [], lastSyncedAt: null };

export class SyncRunner {
  readonly #deps: SyncRunnerDeps;
  #status: SyncStatus = INITIAL;
  #listeners = new Set<() => void>();
  #started = false;
  #paused = false;
  #foreground = true;
  #shopping = false;
  #running: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #interval: ReturnType<typeof setInterval> | null = null;

  constructor(deps: SyncRunnerDeps) {
    this.#deps = deps;
  }

  status = (): SyncStatus => this.#status;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #set(patch: Partial<SyncStatus>): void {
    this.#status = { ...this.#status, ...patch };
    for (const listener of this.#listeners) listener();
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#resetInterval();
    void this.syncNow();
  }

  stop(): void {
    this.#started = false;
    this.#clearTimer();
    this.#resetInterval();
  }

  setForeground(foreground: boolean): void {
    if (this.#foreground === foreground) return;
    this.#foreground = foreground;
    this.#resetInterval();
    if (foreground && this.#started) void this.syncNow();
  }

  setShopping(shopping: boolean): void {
    if (this.#shopping === shopping) return;
    this.#shopping = shopping;
    this.#resetInterval();
  }

  // 書き込みの後に呼ぶ。連続した書き込みを1回の同期にまとめる
  notifyWrite(): void {
    this.#schedule(WRITE_SYNC_DELAY_MS);
  }

  syncNow(): Promise<void> {
    if (this.#paused) return Promise.resolve();
    this.#clearTimer();
    this.#running ??= this.#run().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  // 走っている同期を待ち、止めたまま task を動かす。シートの切り替えとログアウトで、
  // 前のシートの読み取りが新しい中身に混ざらないようにする
  async pause(task: () => void | Promise<void>): Promise<void> {
    this.#paused = true;
    this.#clearTimer();
    try {
      await this.#running;
      await task();
      this.#set(INITIAL);
    } finally {
      this.#paused = false;
    }
  }

  async #run(): Promise<void> {
    this.#set({ running: true });
    try {
      const result = await this.#deps.sync();
      this.#set({
        running: false,
        lastStatus: result.status,
        errorKind: result.error?.kind ?? null,
        // 読めなかった回は、前の知らせを残す
        issues: result.pulled ? result.issues : this.#status.issues,
        lastSyncedAt: result.pulled ? (this.#deps.now ?? Date.now)() : this.#status.lastSyncedAt,
      });
      this.#deps.afterSync?.();
      if (result.status === "deferred") this.#schedule(DEFERRED_SYNC_DELAY_MS);
      else if (result.status === "ok" && this.#deps.pendingCount() > 0) this.#schedule(WRITE_SYNC_DELAY_MS);
    } catch (error) {
      console.warn("同期できなかった", error);
      this.#set({
        running: false,
        lastStatus: "failed",
        errorKind: error instanceof RemoteError ? error.kind : "unknown",
      });
    }
  }

  #schedule(delayMs: number): void {
    if (!this.#started || this.#paused) return;
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.syncNow();
    }, delayMs);
  }

  #clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #resetInterval(): void {
    if (this.#interval !== null) clearInterval(this.#interval);
    this.#interval = null;
    if (this.#started && this.#foreground && this.#shopping) {
      this.#interval = setInterval(() => void this.syncNow(), SHOPPING_SYNC_INTERVAL_MS);
    }
  }
}
