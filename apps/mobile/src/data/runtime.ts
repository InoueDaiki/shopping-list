// データ層の組み立て。アプリに1つだけ持つ。読み込みは同期なので、最初の描画から SQLite の中身が見える
import { SyncEngine, type Id, type SyncResult } from "@shopping-list/core";
import { INITIAL_CATEGORIES, SheetsClient, SheetsRemote, type FetchLike } from "@shopping-list/sheets";

import { auth, getAccessToken, signOut } from "../auth.ts";
import { config } from "../config.ts";
import { accountCheck, ownerValue } from "../logic/account.ts";
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
// 作り始めて、初期化を終えていないシート。次の作成はこのシートの続きを行う
const SHEET_DRAFT_KEY = "sheetDraft";
// 写しの持ち主のメール。SQLite だけに置き、シートへ送らず、ログにも出さない
export const OWNER_KEY = "accountOwner";

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

function learnedOrder(storeId: Id | null): readonly Id[] | null {
  if (storeId === null) return null;
  return orders.learnedOrderFor(storeId, {
    categories: localStore.rows("categories"),
    history: localStore.rows("history"),
    storeOrders: localStore.rows("storeOrders"),
    now: nowIso(),
  });
}

export const repository = new Repository({ store: localStore, newId, now: nowIso, learnedOrder });

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

// 写しが今のアカウントのものと分かるまでは、前の人の変更を送らない
function accountUnconfirmed(): boolean {
  if (auth.state.status !== "signedIn") return false;
  return (
    accountCheck({
      email: auth.state.user.email,
      owner: localStore.setting(OWNER_KEY),
      hasLocalCopy: hasLocalCopy(),
    }) !== "ok"
  );
}

export function hasLocalCopy(): boolean {
  return currentSheet() !== null || localStore.pendingCountNow() > 0;
}

async function runSync(): Promise<SyncResult> {
  const sheet = currentSheet();
  // デモモードと、シートが決まる前は送り先が無い
  if (config.demo || !sheet) return IDLE_RESULT;
  await auth.load();
  if (accountUnconfirmed()) return IDLE_RESULT;
  if (held?.spreadsheetId !== sheet.spreadsheetId) {
    const remote = new SheetsRemote({ client: sheetsClient, spreadsheetId: sheet.spreadsheetId });
    held = { spreadsheetId: sheet.spreadsheetId, engine: new SyncEngine({ local: localStore, remote }) };
  }
  return held.engine.sync();
}

export const syncRunner = new SyncRunner({
  sync: runSync,
  pendingCount: () => localStore.pendingCountNow(),
  afterSync: (result) => {
    repository.finishTrips();
    // 読めなかった回と、Lists の行を読めなかった回は、リストが無いと言い切れない
    if (result.pulled && !result.issues.some((issue) => issue.table === "lists")) repository.removeOrphanItems();
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

// 作りかけのシートの置き場所。createSheet が使う
export const sheetDraftStore = {
  load: () => localStore.setting(SHEET_DRAFT_KEY),
  save: (value: string | null) => localStore.setSetting(SHEET_DRAFT_KEY, value),
};

function ownerSetting(): Record<string, string> {
  const owner = localStore.setting(OWNER_KEY);
  return owner === null ? {} : { [OWNER_KEY]: owner };
}

// シートを決める、または替える。task(シートを開く、作る)が返したシートへ、端末の写しを捨ててから
// 読み直す(送信待ちも消える)。null ならそのまま。通信の間は書き込みを受け付けない
export function switchSheet(task: () => Promise<SheetRef | null>): Promise<boolean> {
  return localStore.whileWritesLocked(async () => {
    const sheet = await task();
    if (sheet === null) return false;
    await syncRunner.pause(() => localStore.wipe({ ...ownerSetting(), [SHEET_KEY]: JSON.stringify(sheet) }));
    await syncRunner.syncNow();
    return true;
  });
}

// ログインしたアカウントを写しの持ち主として覚える
export function adoptAccount(email: string | undefined): void {
  localStore.setSetting(OWNER_KEY, ownerValue(email));
}

// 別のアカウントの写しを捨てて、今のアカウントのものにする(送信待ちも消える)。招待は残す
export async function replaceLocalCopy(email: string | undefined): Promise<void> {
  const invite = localStore.setting(INVITE_KEY);
  await syncRunner.pause(() =>
    localStore.wipe({ [OWNER_KEY]: ownerValue(email), ...(invite === null ? {} : { [INVITE_KEY]: invite }) }),
  );
}

// ログアウトする。次の人に写しを残さない。送信待ちも消えるので、画面が先に確かめる
export async function signOutAndWipe(): Promise<void> {
  await signOut();
  await syncRunner.pause(() => localStore.wipe());
}
