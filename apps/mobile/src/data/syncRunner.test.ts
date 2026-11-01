import { RemoteError, type SyncResult } from "@shopping-list/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFERRED_SYNC_DELAY_MS, RETRY_SYNC_DELAY_MS, SHOPPING_SYNC_INTERVAL_MS, SyncRunner, WRITE_SYNC_DELAY_MS } from "./syncRunner.ts";

const OK: SyncResult = { status: "ok", pushed: 0, superseded: 0, pulled: true, pending: 0, issues: [], error: null };

describe("SyncRunner", () => {
  let result: SyncResult;
  let pending: number;
  const sync = vi.fn(() => Promise.resolve(result));
  const afterSync = vi.fn();
  let runner: SyncRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    result = OK;
    pending = 0;
    runner = new SyncRunner({ sync, afterSync, pendingCount: () => pending });
  });

  afterEach(() => {
    runner.stop();
    vi.useRealTimers();
  });

  it("起動時に1回同期し、終わるたびにトリップを片付ける", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(afterSync).toHaveBeenCalledTimes(1);
    expect(runner.status().lastStatus).toBe("ok");
  });

  it("前面に戻ると同期する", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.setForeground(false);
    runner.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("買い物中で前面にいる間だけ30秒ごとに同期する", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(SHOPPING_SYNC_INTERVAL_MS * 2);
    expect(sync).toHaveBeenCalledTimes(1);
    runner.setShopping(true);
    await vi.advanceTimersByTimeAsync(SHOPPING_SYNC_INTERVAL_MS * 2);
    expect(sync).toHaveBeenCalledTimes(3);
    runner.setForeground(false);
    await vi.advanceTimersByTimeAsync(SHOPPING_SYNC_INTERVAL_MS * 2);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("続けて書いても、最後の書き込みの少し後に1回だけ送る", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.notifyWrite();
    await vi.advanceTimersByTimeAsync(WRITE_SYNC_DELAY_MS - 1);
    runner.notifyWrite();
    await vi.advanceTimersByTimeAsync(WRITE_SYNC_DELAY_MS);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("同期の途中に書いたら、その同期が長引いても終わった後に送る", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    let finish: (value: SyncResult) => void = () => undefined;
    sync.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    void runner.syncNow();
    pending = 1;
    runner.notifyWrite();
    await vi.advanceTimersByTimeAsync(WRITE_SYNC_DELAY_MS * 2);
    // 走っている同期の結果にも、足された分が残りとして数えられている
    finish({ ...OK, pending: 1 });
    pending = 0;
    await vi.advanceTimersByTimeAsync(WRITE_SYNC_DELAY_MS * 2);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("走っている同期に前面の復帰が重なっても、送信の予約を消さない", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    let finish: (value: SyncResult) => void = () => undefined;
    sync.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    void runner.syncNow();
    runner.notifyWrite();
    void runner.syncNow();
    finish(OK);
    await vi.advanceTimersByTimeAsync(WRITE_SYNC_DELAY_MS);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("つながらず未送信が残れば、前面にいる間は間を置いて試す", async () => {
    pending = 1;
    result = { ...OK, status: "failed", pulled: false, pending: 1, error: new RemoteError("offline", "つながらない") };
    runner.start();
    await vi.advanceTimersByTimeAsync(RETRY_SYNC_DELAY_MS);
    expect(sync).toHaveBeenCalledTimes(2);
    runner.setForeground(false);
    await vi.advanceTimersByTimeAsync(RETRY_SYNC_DELAY_MS * 3);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("権限の失敗や未送信が無いときは試し直さない", async () => {
    pending = 1;
    result = { ...OK, status: "failed", pulled: false, pending: 1, error: new RemoteError("forbidden", "権限が無い") };
    runner.start();
    await vi.advanceTimersByTimeAsync(RETRY_SYNC_DELAY_MS * 2);
    expect(sync).toHaveBeenCalledTimes(1);
    pending = 0;
    result = { ...result, pending: 0, error: new RemoteError("offline", "つながらない") };
    await runner.syncNow();
    await vi.advanceTimersByTimeAsync(RETRY_SYNC_DELAY_MS * 2);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("回数の上限で残したら、少し待って試す", async () => {
    result = { ...OK, status: "deferred" };
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    result = OK;
    await vi.advanceTimersByTimeAsync(DEFERRED_SYNC_DELAY_MS);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("隔離された操作だけが残っていても、繰り返し送らない", async () => {
    result = { ...OK, pending: 2 };
    pending = 2;
    runner.start();
    await vi.advanceTimersByTimeAsync(WRITE_SYNC_DELAY_MS * 3);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("失敗の種類と、読み取れなかった行を状態に出す", async () => {
    const issues = [{ table: "items" as const, row: 2, id: null, problems: [] }];
    result = { ...OK, issues };
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.status().issues).toEqual(issues);
    result = { ...OK, status: "failed", pulled: false, error: new RemoteError("offline", "つながらない") };
    await runner.syncNow();
    expect(runner.status()).toMatchObject({ errorKind: "offline", issues });
  });

  it("想定外の例外でも止まらず、状態に出す", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sync.mockRejectedValueOnce(new Error("壊れた"));
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.status()).toMatchObject({ running: false, errorKind: "unknown" });
  });

  it("pause は走っている同期を待ち、その間は新しい同期を始めない", async () => {
    let finish: (value: SyncResult) => void = () => undefined;
    sync.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    runner.start();
    const order: string[] = [];
    const paused = runner.pause(() => {
      order.push("task");
      expect(sync).toHaveBeenCalledTimes(1);
    });
    void runner.syncNow();
    order.push("before");
    finish(OK);
    await paused;
    expect(order).toEqual(["before", "task"]);
    expect(runner.status().lastStatus).toBeNull();
  });
});
