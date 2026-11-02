// 同期をいつ動かすかを決める。起動時、前面に来たとき、背面へ移るとき(未送信があれば)、
// 買い物中は30秒ごと、リストの画面を開いている間は60秒ごと、書き込みの少し後。
// 同じリストをほかの端末も開いていれば、2秒ごとに変更の印だけを読む(回数の計算は logic/liveSync.ts)。
// 結果は画面が読める状態にまとめる
import { RemoteError, type Id, type RemoteErrorKind, type RowIssue, type SyncResult } from "@shopping-list/core";

import {
  othersPresent,
  PEEK_INTERVAL_MS,
  PEEK_PAUSE_MS,
  PRESENCE_INTERVAL_MS,
  PRESENCE_TTL_MS,
  syncCadence,
  type Cadence,
  type PresenceEntry,
} from "../logic/liveSync.ts";

export {
  LIST_SYNC_INTERVAL_MS,
  LIVE_WRITE_SYNC_DELAY_MS,
  PEEK_INTERVAL_MS,
  PEEK_PAUSE_MS,
  PRESENCE_INTERVAL_MS,
  PRESENCE_TTL_MS,
  SHOPPING_SYNC_INTERVAL_MS,
  WRITE_SYNC_DELAY_MS,
} from "../logic/liveSync.ts";
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

export interface LivePeek {
  // 前回の全部の読み取りの後に、ほかの端末が書いた
  changed: boolean;
  presence: readonly PresenceEntry[];
}

// 在室と変更の印。無ければ速い読み取りをしない(デモモードとテスト)
export interface LiveDeps {
  deviceId: () => string;
  // 印と在室だけを読む。送り先が無い、回数が足りないときは null
  peek: () => Promise<LivePeek | null>;
  // 自分の在室を書く。until はこの時刻(ミリ秒)まで開いている。離れたら今の時刻を渡す
  announce: (listId: Id, until: number) => Promise<void>;
}

export interface SyncRunnerDeps {
  sync: () => Promise<SyncResult>;
  live?: LiveDeps;
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
  #viewingListId: Id | null = null;
  #running: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #interval: ReturnType<typeof setInterval> | null = null;
  // 最後に読んだ在室。全部の読み取りでも速い読み取りでも更新する
  #presence: readonly PresenceEntry[] = [];
  #peekTimer: ReturnType<typeof setTimeout> | null = null;
  #peeking = false;
  #peekPausedUntil = 0;
  // 在室を書いているリスト
  #announced: Id | null = null;
  #presenceTimer: ReturnType<typeof setInterval> | null = null;
  #announcing: Promise<void> = Promise.resolve();

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

  #now(): number {
    return (this.#deps.now ?? Date.now)();
  }

  #cadence(): Cadence {
    const deviceId = this.#deps.live?.deviceId() ?? "";
    const present =
      this.#started &&
      this.#deps.live !== undefined &&
      othersPresent(this.#presence, { deviceId, listId: this.#viewingListId, now: this.#now() });
    return syncCadence({
      foreground: this.#foreground,
      shopping: this.#shopping,
      viewingListId: this.#viewingListId,
      othersPresent: present,
    });
  }

  // 全部の読み取りで読んだ在室を渡す
  notePresence(presence: readonly PresenceEntry[]): void {
    this.#presence = presence;
    this.#refreshPeek();
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

  // 前面にあるリストの画面。離れたら null
  setViewingList(listId: Id | null): void {
    if (this.#viewingListId === listId) return;
    this.#viewingListId = listId;
    this.#resetInterval();
  }

  // 書き込みの後に呼ぶ。連続した書き込みを1回の同期にまとめる
  notifyWrite(): void {
    this.#schedule(this.#cadence().writeDelayMs);
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
      // 前のシートの在室を、新しいシートに持ち込まない
      this.#presence = [];
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
      if (result.error?.kind === "rateLimited") this.#pausePeek();
      if (result.status === "deferred") this.#schedule(DEFERRED_SYNC_DELAY_MS);
      // 同期の途中に足された分だけ送り直す。拒否されて隔離された操作は残り続けるので、数に含めない
      else if (result.status === "ok" && this.#deps.pendingCount() > result.pending) {
        this.#schedule(this.#foreground ? this.#cadence().writeDelayMs : 0);
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
    // 全部の読み取りは印も読むので、次の速い読み取りはここから数える
    if (this.#cadence().peek && !this.#peeking) this.#schedulePeek();
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
    const { intervalMs } = this.#cadence();
    if (this.#started && intervalMs !== null) this.#interval = setInterval(() => void this.syncNow(), intervalMs);
    this.#refreshPeek();
    this.#refreshPresence();
  }

  // 相手がいれば速い読み取りを続け、いなければ止める
  #refreshPeek(): void {
    if (!this.#cadence().peek) {
      if (this.#peekTimer !== null) clearTimeout(this.#peekTimer);
      this.#peekTimer = null;
    } else if (this.#peekTimer === null && !this.#peeking) {
      this.#schedulePeek();
    }
  }

  #schedulePeek(): void {
    if (this.#peekTimer !== null) clearTimeout(this.#peekTimer);
    this.#peekTimer = setTimeout(() => void this.#peek(), PEEK_INTERVAL_MS);
  }

  #pausePeek(): void {
    this.#peekPausedUntil = this.#now() + PEEK_PAUSE_MS;
  }

  async #peek(): Promise<void> {
    this.#peekTimer = null;
    const live = this.#deps.live;
    if (live === undefined || !this.#cadence().peek) return;
    // 同期の最中は、その読み取りが印も読む。429 の後は、回数が戻るまで待つ
    if (this.#running !== null || this.#paused || this.#now() < this.#peekPausedUntil) {
      this.#schedulePeek();
      return;
    }
    this.#peeking = true;
    try {
      const peek = await live.peek();
      if (peek !== null) {
        this.#presence = peek.presence;
        if (peek.changed && !this.#paused) void this.syncNow();
      }
    } catch (error) {
      console.warn("印を読めなかった", error instanceof Error ? error.name : "unknown");
      this.#pausePeek();
    } finally {
      this.#peeking = false;
    }
    this.#refreshPeek();
  }

  // 前面のリストの画面にいる間は在室を書き続け、離れたら今の時刻を書いて消したことにする
  #refreshPresence(): void {
    if (this.#deps.live === undefined) return;
    const listId = this.#started && this.#foreground ? this.#viewingListId : null;
    if (listId === this.#announced) return;
    if (this.#presenceTimer !== null) clearInterval(this.#presenceTimer);
    this.#presenceTimer = null;
    const left = this.#announced;
    this.#announced = listId;
    if (left !== null) this.#announce(left, 0);
    if (listId !== null) {
      this.#announce(listId, PRESENCE_TTL_MS);
      this.#presenceTimer = setInterval(() => this.#announce(listId, PRESENCE_TTL_MS), PRESENCE_INTERVAL_MS);
    }
  }

  // 順に書く。離れた後に、前の在室の書き込みが追い越さないようにする
  #announce(listId: Id, ttlMs: number): void {
    const live = this.#deps.live;
    if (live === undefined) return;
    this.#announcing = this.#announcing
      .then(async () => {
        if (this.#paused) return;
        // 起動の直後は、同期の読み取りが自分の行を見つけるのを待つ(先に読む分を省く)
        await this.#running;
        await live.announce(listId, this.#now() + ttlMs);
      })
      .catch((error: unknown) => {
        console.warn("在室を書けなかった", error instanceof Error ? error.name : "unknown");
      });
  }
}
