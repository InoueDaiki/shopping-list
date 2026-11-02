// 2人が同じリストを開いているときに、相手の変更を数秒で出すための判定。
// 在室(Presence)を読み、自分以外の端末が同じリストを開いていれば、変更の印だけを短い間隔で読む。
//
// 回数の上限は端末ごとに毎分 読み取り60回、書き込み60回。同期と在室と印で RateBudget(毎分50回)を分け合う。
// 実際のコードの要求の回数(設計メモの「2人が同じリストを開いているとき」に表がある):
// - 全部の読み取り(pull): 読み取り1回。表、Meta(版と印)、History の続き、Presence を1回の batchGet で読む
// - 送信: locate の読み取り1回と batchUpdate の書き込み1回。印は同じ batchUpdate に入れる
// - 速い読み取り: 読み取り1回。在室: 書き込み1回(自分の行が分からないときだけ読み取り +1)
// 相手がいる間の1分あたり(2人とも10秒に1回チェックする買い物):
// - 読み取り: 速い読み取り30回(全部の読み取りの後はその時から2秒あけるので、置き換わる)+ 送信の locate 6回 ≒ 36回
// - 書き込み: 送信6回 + 在室1回 ≒ 7回
// どちらも50回に収まる。もっと速く書き続けて50回に届いたら、エンジンが止めて次へ回す。
// 速い読み取りは PEEK_READ_RESERVE を残して止まるので、同期の分を使い切らない
import type { Id } from "@shopping-list/core";

export const SHOPPING_SYNC_INTERVAL_MS = 30_000;
// 買い物をしていなくても、リストの画面を開いている間はもう1人の変更を読む
export const LIST_SYNC_INTERVAL_MS = 60_000;
// 続けて書いても1回の送信にまとめる
export const WRITE_SYNC_DELAY_MS = 3_000;
// 相手がいる間は、自分の変更も早く送る
export const LIVE_WRITE_SYNC_DELAY_MS = 1_000;
// 相手がいる間に、印と在室だけを読む間。全部の読み取りの後はその時から数え直す
export const PEEK_INTERVAL_MS = 2_000;
// 速い読み取りが残しておく、毎分の読み取りの回数。同期(送信と全部の読み取り)に回す
export const PEEK_READ_RESERVE = 10;
// 速い読み取りが失敗したら(429 など)、この間は止める。窓が1分なので、1分待てば回数が戻る
export const PEEK_PAUSE_MS = 60_000;
// 在室を書き直す間と、書いた在室の有効な長さ。1回書けなくても、次で間に合う
export const PRESENCE_INTERVAL_MS = 60_000;
export const PRESENCE_TTL_MS = 90_000;

export interface PresenceEntry {
  deviceId: string;
  listId: Id;
  until: string;
}

// 自分以外の端末が、同じリストを今開いているか。until が今より後なら開いている
export function othersPresent(
  presence: readonly PresenceEntry[],
  { deviceId, listId, now }: { deviceId: string; listId: Id | null; now: number },
): boolean {
  if (listId === null) return false;
  return presence.some(
    (entry) => entry.deviceId !== deviceId && entry.listId === listId && Date.parse(entry.until) > now,
  );
}

export interface CadenceInput {
  foreground: boolean;
  shopping: boolean;
  viewingListId: Id | null;
  othersPresent: boolean;
}

export interface Cadence {
  // 全部を読む間。null なら読まない
  intervalMs: number | null;
  // 印と在室だけを読む。相手がいるときだけ
  peek: boolean;
  writeDelayMs: number;
}

// いつ読むか。間隔は重ねず、短いほうの1本だけにする
export function syncCadence({ foreground, shopping, viewingListId, othersPresent: present }: CadenceInput): Cadence {
  const viewing = foreground && viewingListId !== null;
  const live = viewing && present;
  return {
    intervalMs: !foreground ? null : shopping ? SHOPPING_SYNC_INTERVAL_MS : viewing ? LIST_SYNC_INTERVAL_MS : null,
    peek: live,
    writeDelayMs: live ? LIVE_WRITE_SYNC_DELAY_MS : WRITE_SYNC_DELAY_MS,
  };
}
