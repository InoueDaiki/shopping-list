// 同期の本体。送信待ちを送ってから、リモートの内容を写す。
// いつ呼ぶか(前面に来たとき、買い物の間は30秒ごと)はアプリが決める。

import { DEFAULT_RATE_LIMITS, RateBudget, type RateLimits } from "./budget.ts";
import { coalesceOps, planPush } from "./plan.ts";
import {
  RemoteError,
  type LocalStore,
  type MutableTable,
  type RemoteApply,
  type RemoteStore,
  type RowIssue,
} from "./types.ts";

// 1回の書き込みに載せる操作の数
export const DEFAULT_MAX_OPS_PER_PUSH = 200;

export interface SyncEngineOptions {
  local: LocalStore;
  remote: RemoteStore;
  now?: () => number;
  limits?: RateLimits;
  maxOpsPerPush?: number;
}

export interface SyncResult {
  // ok: 全部終えた。deferred: 回数の上限で残した。failed: リモートの失敗で止めた
  status: "ok" | "deferred" | "failed";
  pushed: number;
  // 後勝ちで負けて、リモートの値を取った操作の数
  superseded: number;
  pulled: boolean;
  pending: number;
  issues: RowIssue[];
  // status が failed のとき。送信待ちは残っている
  error: RemoteError | null;
}

function keepFromIssues(issues: RowIssue[]): RemoteApply["keep"] {
  const keep: RemoteApply["keep"] = {};
  for (const issue of issues) {
    if (issue.id === null || issue.table === "history") continue;
    (keep[issue.table] ??= []).push(issue.id);
  }
  return keep;
}

export class SyncEngine {
  readonly #local: LocalStore;
  readonly #remote: RemoteStore;
  readonly #budget: RateBudget;
  readonly #maxOpsPerPush: number;
  #running: Promise<SyncResult> | null = null;

  constructor(options: SyncEngineOptions) {
    this.#local = options.local;
    this.#remote = options.remote;
    this.#budget = new RateBudget(
      options.limits ?? DEFAULT_RATE_LIMITS,
      options.now ?? Date.now,
    );
    this.#maxOpsPerPush = options.maxOpsPerPush ?? DEFAULT_MAX_OPS_PER_PUSH;
  }

  // 同時には1つだけ走らせる。走っている間に呼ぶと、同じ結果を返す
  sync(): Promise<SyncResult> {
    this.#running ??= this.#run().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #run(): Promise<SyncResult> {
    const result: SyncResult = {
      status: "ok",
      pushed: 0,
      superseded: 0,
      pulled: false,
      pending: 0,
      issues: [],
      error: null,
    };
    try {
      await this.#push(result);
      await this.#pull(result);
    } catch (error) {
      if (!(error instanceof RemoteError)) throw error;
      result.status = "failed";
      result.error = error;
    }
    result.pending = await this.#local.pendingCount();
    return result;
  }

  async #push(result: SyncResult): Promise<void> {
    for (;;) {
      const pending = await this.#local.pendingOps(this.#maxOpsPerPush);
      if (pending.length === 0) return;

      const ops = coalesceOps(pending);
      const tables = new Set<MutableTable>();
      for (const op of ops) {
        if (op.table !== "history") tables.add(op.table);
      }
      if (!this.#budget.tryTake(tables.size > 0 ? 1 : 0, 1)) {
        result.status = "deferred";
        return;
      }
      const index = tables.size > 0 ? await this.#remote.locate([...tables]) : {};
      const plan = planPush(ops, index);
      if (plan.writes.length > 0) await this.#remote.write(plan.writes);
      await this.#local.ackOps(pending.map((op) => op.seq));
      result.pushed += plan.written;
      result.superseded += plan.superseded;
    }
  }

  async #pull(result: SyncResult): Promise<void> {
    if (!this.#budget.tryTake(1, 0)) {
      result.status = "deferred";
      return;
    }
    const snapshot = await this.#remote.pull(await this.#local.historyCursor());
    await this.#local.applyRemote({
      tables: snapshot.tables,
      history: snapshot.history,
      historyCursor: snapshot.historyCursor,
      keep: keepFromIssues(snapshot.issues),
    });
    result.pulled = true;
    result.issues = snapshot.issues;
  }
}
