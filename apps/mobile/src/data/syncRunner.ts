// 同期をいつ動かすかを決める。起動時、前面に来たとき、背面へ移るとき(未送信があれば)、
// 買い物中は30秒ごと、リストの画面を開いている間は60秒ごと、書き込みの少し後。
// 結果は画面が読める状態にまとめる
import { RemoteError, type RemoteErrorKind, type RowIssue, type SyncResult } from "@shopping-list/core";

export const SHOPPING_SYNC_INTERVAL_MS = 30_000;
// 買い物をしていなくても、リストの画面を開いている間はもう1人の変更を読む。
// 同期1回は読み取り1回から3回なので、毎分60回の上限に十分な余裕がある
export const LIST_SYNC_INTERVAL_MS = 60_000;
// 続けて書いても1回の送信にまとめる
export const WRITE_SYNC_DELAY_MS = 3_000;
// 回数の上限で残したときに、もう一度試すまでの間
export const DEFERRED_SYNC_DELAY_MS = 20_000;
// つながらなかったときに、未送信をもう一度試すまでの間
export const RETRY_SYNC_DELAY_MS = 30_000;

export interface SyncStatus {
  running: boolean;
  lastStatus: SyncResult["status"] | null;
  errorKind: RemoteErrorKind | "unknown" | null;
  issues: readonly RowIssue[];
  lastSyncedAt: number | null;
}

export interface SyncRunnerDeps {
  sync: () => Promise<SyncResult>;
  // 同期が終わるたびに呼ぶ(トリップの片付け、リストの無い品目と店舗の片付け)
  afterSync?: (result: SyncResult) => void;
  // 送信待ちの数。同期の途中で足された分を送り直すのに使う
  pendingCount: () => number;
  now?: () => number;
}

// 待てば直る失敗。権限やシートの形の問題は、繰り返しても直らない
const RETRYABLE_ERRORS: readonly SyncStatus["errorKind"][] = ["offline", "rateLimited", "server"];

const INITIAL: SyncStatus = { running: false, lastStatus: null, errorKind: null, issues: [], lastSyncedAt: null };

export class SyncRunner {
  readonly #deps: SyncRunnerDeps;
  #status: SyncStatus = INITIAL;
  #listeners = new Set<() => void>();
  #started = false;
  #paused = false;
  #foreground = true;
  #shopping = false;
  #viewingList = false;
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
    // 背面では止められることがあるので、未送信は待たずに送る
    if (this.#started && (foreground || this.#deps.pendingCount() > 0)) void this.syncNow();
  }

  setShopping(shopping: boolean): void {
    if (this.#shopping === shopping) return;
    this.#shopping = shopping;
    this.#resetInterval();
  }

  setViewingList(viewing: boolean): void {
    if (this.#viewingList === viewing) return;
    this.#viewingList = viewing;
    this.#resetInterval();
  }

  // 書き込みの後に呼ぶ。連続した書き込みを1回の同期にまとめる
  notifyWrite(): void {
    this.#schedule(WRITE_SYNC_DELAY_MS);
  }

  syncNow(): Promise<void> {
    if (this.#paused) return Promise.resolve();
    // 走っている同期は、後から足された分を送るとは限らない。待っている送信の予約を消さない
    if (this.#running) return this.#running;
    this.#clearTimer();
    this.#running = this.#run().finally(() => {
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
      this.#deps.afterSync?.(result);
      if (result.status === "deferred") this.#schedule(DEFERRED_SYNC_DELAY_MS);
      // 同期の途中に足された分だけ送り直す。拒否されて隔離された操作は残り続けるので、数に含めない
      else if (result.status === "ok" && this.#deps.pendingCount() > result.pending) {
        this.#schedule(this.#foreground ? WRITE_SYNC_DELAY_MS : 0);
      }
      else if (result.status === "failed") this.#retryLater();
    } catch (error) {
      // シート ID を含むかもしれないので、本文は出さない
      console.warn("同期できなかった", error instanceof Error ? error.name : "unknown");
      this.#set({
        running: false,
        lastStatus: "failed",
        errorKind: error instanceof RemoteError ? error.kind : "unknown",
      });
      this.#retryLater();
    }
  }

  // 前面にいる間は、つながるのを待って送り直す(裏では前面に戻ったときに送る)
  #retryLater(): void {
    if (this.#foreground && RETRYABLE_ERRORS.includes(this.#status.errorKind) && this.#deps.pendingCount() > 0) {
      this.#schedule(RETRY_SYNC_DELAY_MS);
    }
  }

  #schedule(delayMs: number): void {
    if (!this.#started || this.#paused) return;
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      // 走っている同期に相乗りすると、その後に足された分が送られない。終わるのを待つ
      if (this.#running) this.#schedule(delayMs);
      else void this.syncNow();
    }, delayMs);
  }

  #clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #resetInterval(): void {
    if (this.#interval !== null) clearInterval(this.#interval);
    this.#interval = null;
    if (!this.#started || !this.#foreground) return;
    const intervalMs = this.#shopping ? SHOPPING_SYNC_INTERVAL_MS : this.#viewingList ? LIST_SYNC_INTERVAL_MS : null;
    if (intervalMs !== null) this.#interval = setInterval(() => void this.syncNow(), intervalMs);
  }
}
