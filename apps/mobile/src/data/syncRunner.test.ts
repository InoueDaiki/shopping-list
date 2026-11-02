import { RemoteError, type SyncResult } from "@shopping-list/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFERRED_SYNC_DELAY_MS,
  LIST_SYNC_INTERVAL_MS,
  LIVE_WRITE_SYNC_DELAY_MS,
  PEEK_INTERVAL_MS,
  PEEK_PAUSE_MS,
  PRESENCE_INTERVAL_MS,
  PRESENCE_TTL_MS,
  RETRY_SYNC_DELAY_MS,
  SHOPPING_SYNC_INTERVAL_MS,
  SyncRunner,
  WRITE_SYNC_DELAY_MS,
  type LivePeek,
} from "./syncRunner.ts";

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

  it("背面へ移るときに未送信を待たずに送る", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    pending = 2;
    result = { ...OK, pending: 2 };
    runner.notifyWrite();
    runner.setForeground(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
    // 待っていた送信の予約は残らない
    await vi.advanceTimersByTimeAsync(WRITE_SYNC_DELAY_MS);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("未送信が無ければ、背面へ移るときに通信しない", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.setForeground(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("背面へ移るとき走っていた同期の後に足された分も、すぐに送る", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    let finish = (_: SyncResult) => {};
    sync.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    pending = 1;
    runner.setForeground(false);
    pending = 2;
    finish({ ...OK, pending: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("リストの画面を開いている間は60秒ごとに読み、回数の上限に届かない", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.setViewingList("list1");
    await vi.advanceTimersByTimeAsync(LIST_SYNC_INTERVAL_MS * 10);
    expect(sync).toHaveBeenCalledTimes(11);

    runner.setViewingList(null);
    await vi.advanceTimersByTimeAsync(LIST_SYNC_INTERVAL_MS * 3);
    expect(sync).toHaveBeenCalledTimes(11);
  });

  it("買い物中はリストの画面でも30秒ごとのまま重ねない", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.setShopping(true);
    runner.setViewingList("list1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("背面ではリストの画面の読み取りを止める", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.setViewingList("list1");
    runner.setForeground(false);
    await vi.advanceTimersByTimeAsync(LIST_SYNC_INTERVAL_MS * 3);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("結果を片付けに渡す", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(afterSync).toHaveBeenCalledWith(OK);
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

describe("SyncRunner の在室と速い読み取り", () => {
  const sync = vi.fn(() => Promise.resolve(OK));
  const peek = vi.fn<() => Promise<LivePeek | null>>();
  const announce = vi.fn((_listId: string, _until: number) => Promise.resolve());
  let pending: number;
  let runner: SyncRunner;
  const other = (until: number, listId = "list1") => ({ deviceId: "deviceB", listId, until: new Date(until).toISOString() });
  const mine = (until: number) => ({ deviceId: "deviceA", listId: "list1", until: new Date(until).toISOString() });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    pending = 0;
    peek.mockImplementation(async () => ({ changed: false, presence: [other(Date.now() + PRESENCE_TTL_MS)] }));
    runner = new SyncRunner({
      sync,
      pendingCount: () => pending,
      live: { deviceId: () => "deviceA", peek, announce },
    });
  });

  afterEach(() => {
    runner.stop();
    vi.useRealTimers();
  });

  // 起動して、相手が同じリストを開いている状態にする
  const startLive = async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.setViewingList("list1");
    runner.notePresence([other(Date.now() + PRESENCE_TTL_MS)]);
    await vi.advanceTimersByTimeAsync(0);
    sync.mockClear();
    announce.mockClear();
  };

  it("相手がいなければ速い読み取りをせず、今までの間隔で読む", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.setViewingList("list1");
    runner.notePresence([mine(Date.now() + PRESENCE_TTL_MS), other(Date.now() + PRESENCE_TTL_MS, "list2")]);
    await vi.advanceTimersByTimeAsync(LIST_SYNC_INTERVAL_MS);
    expect(peek).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("相手がいる間は2秒ごとに印だけを読み、変わったときだけ全部を読む", async () => {
    await startLive();
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS * 5);
    expect(peek).toHaveBeenCalledTimes(5);
    expect(sync).not.toHaveBeenCalled();

    peek.mockImplementationOnce(async () => ({ changed: true, presence: [other(Date.now() + PRESENCE_TTL_MS)] }));
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("1分の読み取りは、速い読み取りと間の分の全部の読み取りを足しても31回まで", async () => {
    await startLive();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(peek.mock.calls.length + sync.mock.calls.length).toBeLessThanOrEqual(31);
  });

  it("全部の読み取りの後は、その時から2秒あけて印を読む", async () => {
    await startLive();
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS - 500);
    await runner.syncNow();
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS - 1);
    expect(peek).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(peek).toHaveBeenCalledTimes(1);
  });

  it("相手がいなくなったら速い読み取りをやめる", async () => {
    await startLive();
    peek.mockImplementation(async () => ({ changed: false, presence: [other(Date.now())] }));
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS * 5);
    expect(peek).toHaveBeenCalledTimes(1);
  });

  it("相手の在室が切れたら、読み直さなくてもやめる", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.setViewingList("list1");
    runner.notePresence([other(Date.now() + PEEK_INTERVAL_MS * 2 + 1)]);
    peek.mockImplementation(async () => null);
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS * 5);
    expect(peek).toHaveBeenCalledTimes(2);
  });

  it("背面ではやめ、別の画面に移ってもやめる", async () => {
    await startLive();
    runner.setForeground(false);
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS * 3);
    expect(peek).not.toHaveBeenCalled();
    runner.setForeground(true);
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS);
    expect(peek).toHaveBeenCalledTimes(1);
    runner.setViewingList(null);
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS * 3);
    expect(peek).toHaveBeenCalledTimes(1);
  });

  it("相手がいる間は、自分の変更を1秒後に送る", async () => {
    await startLive();
    pending = 1;
    runner.notifyWrite();
    await vi.advanceTimersByTimeAsync(LIVE_WRITE_SYNC_DELAY_MS);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("読み取りが失敗したら(429 など)、しばらく速い読み取りを止める", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await startLive();
    peek.mockRejectedValueOnce(new RemoteError("rateLimited", "429"));
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS);
    expect(peek).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PEEK_PAUSE_MS - PEEK_INTERVAL_MS);
    expect(peek).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PEEK_INTERVAL_MS);
    expect(peek).toHaveBeenCalledTimes(2);
  });

  it("全部の読み取りが 429 で失敗しても、速い読み取りを止める", async () => {
    await startLive();
    sync.mockResolvedValueOnce({ ...OK, status: "failed", pulled: false, error: new RemoteError("rateLimited", "429") });
    await runner.syncNow();
    await vi.advanceTimersByTimeAsync(PEEK_PAUSE_MS - 1);
    expect(peek).not.toHaveBeenCalled();
  });

  it("リストの画面にいる間は在室を60秒ごとに書き、離れたら今の時刻を書く", async () => {
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    const opened = Date.now();
    runner.setViewingList("list1");
    await vi.advanceTimersByTimeAsync(0);
    expect(announce).toHaveBeenLastCalledWith("list1", opened + PRESENCE_TTL_MS);
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS * 2);
    expect(announce).toHaveBeenCalledTimes(3);

    runner.setViewingList(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(announce).toHaveBeenCalledTimes(4);
    expect(announce).toHaveBeenLastCalledWith("list1", Date.now());
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS * 2);
    expect(announce).toHaveBeenCalledTimes(4);
  });

  it("背面へ移ると在室を消し、戻ると書き直す", async () => {
    await startLive();
    runner.setForeground(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(announce).toHaveBeenLastCalledWith("list1", Date.now());
    runner.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(announce).toHaveBeenLastCalledWith("list1", Date.now() + PRESENCE_TTL_MS);
  });

  it("在室を書けなくても止まらない", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    announce.mockRejectedValueOnce(new RemoteError("offline", "つながらない"));
    runner.setViewingList("list1");
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
    expect(announce).toHaveBeenCalledTimes(2);
  });
});
