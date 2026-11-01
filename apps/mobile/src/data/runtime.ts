// データ層の組み立て。アプリに1つだけ持つ。読み込みは同期なので、最初の描画から SQLite の中身が見える
import { SyncEngine, type Id, type SyncResult } from "@shopping-list/core";
import { INITIAL_CATEGORIES, SheetsClient, SheetsRemote, type FetchLike } from "@shopping-list/sheets";

import { getAccessToken, signOut } from "../auth.ts";
import { config } from "../config.ts";
import { seedDemo } from "./demo.ts";
import { openDatabase } from "./expoDb.ts";
import { newId } from "./ids.ts";
import { SqliteLocalStore } from "./localStore.ts";
import { OrderCache } from "./ordering.ts";
import { Repository } from "./repository.ts";
import { sheetTokenProvider } from "./sheetToken.ts";
import type { SheetRef } from "./spreadsheet.ts";
import { SyncRunner } from "./syncRunner.ts";

export const SHEET_KEY = "spreadsheet";
// 開かれた招待リンクのシート ID。ログインと確認が終わるまで持つ
export const INVITE_KEY = "pendingInvite";

const nowIso = () => new Date().toISOString();

// デモの端末で本物の写しを壊さないよう、ファイルも分ける
export const localStore = new SqliteLocalStore(openDatabase(config.demo ? "demo.db" : "shopping.db"), {
  recordPending: !config.demo,
});

const orders = new OrderCache();

export function orderForStore(storeId: Id | null): readonly Id[] {
  return orders.orderFor(storeId, {
    categories: localStore.rows("categories"),
    history: localStore.rows("history"),
    storeOrders: localStore.rows("storeOrders"),
    now: nowIso(),
  });
}

export const repository = new Repository({ store: localStore, newId, now: nowIso, orderForStore });

export const sheetsClient = new SheetsClient({
  fetch: (url, init) => fetch(url, init as RequestInit),
  getAccessToken: sheetTokenProvider(getAccessToken),
} satisfies { fetch: FetchLike; getAccessToken: ReturnType<typeof sheetTokenProvider> });

export function currentSheet(): SheetRef | null {
  const stored = localStore.setting(SHEET_KEY);
  return stored === null ? null : (JSON.parse(stored) as SheetRef);
}

let held: { spreadsheetId: string; engine: SyncEngine } | null = null;

const IDLE_RESULT: SyncResult = { status: "ok", pushed: 0, superseded: 0, pulled: false, pending: 0, issues: [], error: null };

function runSync(): Promise<SyncResult> {
  const sheet = currentSheet();
  // デモモードと、シートが決まる前は送り先が無い
  if (config.demo || !sheet) return Promise.resolve(IDLE_RESULT);
  if (held?.spreadsheetId !== sheet.spreadsheetId) {
    const remote = new SheetsRemote({ client: sheetsClient, spreadsheetId: sheet.spreadsheetId });
    held = { spreadsheetId: sheet.spreadsheetId, engine: new SyncEngine({ local: localStore, remote }) };
  }
  return held.engine.sync();
}

export const syncRunner = new SyncRunner({
  sync: runSync,
  pendingCount: () => localStore.pendingCountNow(),
  afterSync: () => {
    repository.finishTrips();
    syncRunner.setShopping(repository.currentSession() !== null);
  },
});

// 買い物中だけ30秒ごとに読む
localStore.subscribe("settings", () => syncRunner.setShopping(repository.currentSession() !== null));

if (config.demo) {
  seedDemo({ store: localStore, repository, categories: INITIAL_CATEGORIES, newId, now: new Date() });
} else {
  // 画面の書き込みのたびに、少し遅らせて送る
  localStore.subscribe("pending", () => {
    if (localStore.pendingCountNow() > 0) syncRunner.notifyWrite();
  });
}

export function rememberInvite(spreadsheetId: string): void {
  localStore.setSetting(INVITE_KEY, spreadsheetId);
}

export function forgetInvite(): void {
  localStore.setSetting(INVITE_KEY, null);
}

// シートを決める、または替える。端末の写しを捨ててから読み直す(送信待ちも消える)
export async function connectSheet(sheet: SheetRef): Promise<void> {
  await syncRunner.pause(() => localStore.wipe({ [SHEET_KEY]: JSON.stringify(sheet) }));
  await syncRunner.syncNow();
}

// ログアウトする。次の人に写しを残さない。送信待ちも消えるので、画面が先に確かめる
export async function signOutAndWipe(): Promise<void> {
  await signOut();
  await syncRunner.pause(() => localStore.wipe());
}
