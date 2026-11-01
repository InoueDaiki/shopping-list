// 同期の本体。送信待ちを送ってから、リモートの内容を写す。
// いつ呼ぶか(前面に来たとき、買い物の間は30秒ごと)はアプリが決める。

import { DEFAULT_RATE_LIMITS, RateBudget, type RateLimits } from "./budget.ts";
import { coalesceOps, planPush, type PushStep } from "./plan.ts";
import { changeId, changeKey } from "./rows.ts";
import {
  RemoteError,
  type LocalStore,
  type MutableTable,
  type PendingOp,
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
  // ok: 送れる操作を全部終えた(隔離した操作は issues に出て、pending に残る)。
  // deferred: 回数の上限で残した。failed: リモートの失敗で止めた
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

// 拒否された操作。送信待ちに残したまま、利用者が直すかアプリを開き直すまで送らない。
// LocalStore には残さないので、開き直すと1回だけ試し直す
interface QuarantinedOp {
  // 拒否された操作の seq。同じ行のもっと新しい操作は試す
  seq: number;
  // 同じ行の送信待ちの数
  held: number;
  issue: RowIssue;
}

function rejectionIssue({ op, write }: PushStep, error: RemoteError): RowIssue {
  return {
    table: op.table,
    row: write.kind === "insert" ? 0 : write.rowNumber,
    id: changeId(op),
    problems: [{ column: "*", message: error.message }],
  };
}

export class SyncEngine {
  readonly #local: LocalStore;
  readonly #remote: RemoteStore;
  readonly #budget: RateBudget;
  readonly #maxOpsPerPush: number;
  #running: Promise<SyncResult> | null = null;
  readonly #quarantined = new Map<string, QuarantinedOp>();

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
    result.issues = [
      ...[...this.#quarantined.values()].map(({ issue }) => issue),
      ...result.issues,
    ];
    result.pending = await this.#local.pendingCount();
    return result;
  }

  async #push(result: SyncResult): Promise<void> {
    for (;;) {
      // 隔離した操作が列の先頭に居座っても、後ろの操作を送れるようにする
      let held = 0;
      for (const quarantined of this.#quarantined.values()) held += quarantined.held;
      const pending = await this.#local.pendingOps(this.#maxOpsPerPush + held);

      const seqsByKey = new Map<string, number[]>();
      for (const op of pending) {
        const key = changeKey(op);
        seqsByKey.set(key, [...(seqsByKey.get(key) ?? []), op.seq]);
      }
      const ops = coalesceOps(pending).filter(
        (op) => this.#quarantined.get(changeKey(op))?.seq !== op.seq,
      );
      if (ops.length === 0) return;

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
      await this.#ack(plan.settled, seqsByKey);
      result.superseded += plan.superseded;
      if (!(await this.#send(plan.steps, seqsByKey, result))) return;
    }
  }

  // 書いて確認する。中身を拒否されたら半分に分けて送り直し、原因の1件を隔離する。
  // 行の位置はずれないので、同じ計画のまま分けられる。回数の上限で止めたら false を返す
  async #send(
    steps: PushStep[],
    seqsByKey: Map<string, number[]>,
    result: SyncResult,
  ): Promise<boolean> {
    const batches = steps.length > 0 ? [steps] : [];
    // 最初の1回の分は #push で数えた
    let charged = true;
    for (let batch = batches.pop(); batch !== undefined; batch = batches.pop()) {
      if (!charged && !this.#budget.tryTake(0, 1)) {
        result.status = "deferred";
        return false;
      }
      charged = false;
      try {
        await this.#remote.write(batch.map(({ write }) => write));
      } catch (error) {
        if (!(error instanceof RemoteError) || error.kind !== "invalid") throw error;
        const [only] = batch;
        if (batch.length === 1 && only !== undefined) {
          const key = changeKey(only.op);
          this.#quarantined.set(key, {
            seq: only.op.seq,
            held: seqsByKey.get(key)?.length ?? 1,
            issue: rejectionIssue(only, error),
          });
        } else {
          const middle = Math.ceil(batch.length / 2);
          batches.push(batch.slice(middle), batch.slice(0, middle));
        }
        continue;
      }
      // 分けて送っている間に止まっても、書けた分を送り直さないよう、その都度確認する
      await this.#ack(
        batch.map(({ op }) => op),
        seqsByKey,
      );
      result.pushed += batch.length;
    }
    return true;
  }

  // 同じ行のまとめられた操作も一緒に確認する
  async #ack(ops: PendingOp[], seqsByKey: Map<string, number[]>): Promise<void> {
    if (ops.length === 0) return;
    const keys = ops.map(changeKey);
    await this.#local.ackOps(keys.flatMap((key) => seqsByKey.get(key) ?? []));
    for (const key of keys) this.#quarantined.delete(key);
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
