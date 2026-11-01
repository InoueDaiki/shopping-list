// 送信待ちを、リモートへの書き込みに変える。副作用の無い計算だけを置く。

import type { Iso, Item } from "../types.ts";
import { changeKey, compareIso, rowVersion } from "./rows.ts";
import type {
  ItemPart,
  PendingOp,
  RemoteIndex,
  RemoteRowRef,
  RemoteWrite,
  SyncTable,
} from "./types.ts";

// 入力規則(プルダウンの参照先)に当たらないよう、参照される表を先に書く
const MASTER_TABLES: readonly SyncTable[] = ["lists", "categories", "stores"];

// 同じ行の操作は最後の1件にまとめる
export function coalesceOps(ops: PendingOp[]): PendingOp[] {
  const latest = new Map<string, PendingOp>();
  for (const op of ops) {
    latest.set(changeKey(op), op);
  }
  return [...latest.values()];
}

// ローカルの版がリモートに勝つか。同時刻はリモートを残す(どちらの端末でも同じ結果になる)
function wins(local: Iso | null, remote: Iso | null): boolean {
  if (local === null || remote === null) return true;
  return compareIso(local, remote) > 0;
}

// 新しい順。読めない版は後ろに回す。同じ版は上の行を先にする(読むときの選び方と同じ)
function newestFirst(a: RemoteRowRef, b: RemoteRowRef): number {
  if (a.version === null || b.version === null) {
    if (a.version !== b.version) return a.version === null ? 1 : -1;
    return a.rowNumber - b.rowNumber;
  }
  return compareIso(b.version, a.version) || a.rowNumber - b.rowNumber;
}

// Items の put で、勝った部分を返す。全部なら undefined、どちらも負けたら null。
// 操作は行全体を持つが、触っていない部分の版は古いままなので、勝つのは触った部分だけになる
function winningItemPart(row: Item, head: RemoteRowRef): ItemPart | undefined | null {
  const body = wins(row.updatedAt, head.parts?.body ?? head.version);
  const check = wins(row.checkedUpdatedAt, head.parts?.check ?? head.version);
  if (body && check) return undefined;
  if (body) return "body";
  return check ? "check" : null;
}

// 1件の書き込みと、その元の操作
export interface PushStep {
  op: PendingOp;
  write: RemoteWrite;
}

export interface PushPlan {
  steps: PushStep[];
  // 書かずに終わる操作(後勝ちで負けた、消す行が無い)
  settled: PendingOp[];
  // settled のうち後勝ちで負けた操作の数。リモートの値は続く pull で取り込む
  superseded: number;
}

export function planPush(ops: PendingOp[], index: RemoteIndex): PushPlan {
  const refsByKey = new Map<string, RemoteRowRef[]>();
  for (const [table, refs] of Object.entries(index)) {
    for (const ref of refs) {
      const key = `${table}\0${ref.id}`;
      refsByKey.set(key, [...(refsByKey.get(key) ?? []), ref]);
    }
  }

  const masterInserts: PushStep[] = [];
  const updates: PushStep[] = [];
  const otherInserts: PushStep[] = [];
  const tombstones: PushStep[] = [];
  const settled: PendingOp[] = [];
  let superseded = 0;

  for (const op of ops) {
    if (op.action === "put" && op.table === "history") {
      otherInserts.push({ op, write: { kind: "insert", table: op.table, row: op.row } });
      continue;
    }
    // 同じ ID の行が重なっていても、消さずに新しい1行だけを書く。読むときは新しい行を取る
    const [head] = [...(refsByKey.get(changeKey(op)) ?? [])].sort(newestFirst);

    if (op.action === "delete") {
      if (head === undefined) {
        settled.push(op);
      } else if (wins(op.at, head.version)) {
        const write: RemoteWrite = {
          kind: "tombstone",
          table: op.table,
          rowNumber: head.rowNumber,
          at: op.at,
        };
        tombstones.push({ op, write });
      } else {
        settled.push(op);
        superseded += 1;
      }
      continue;
    }

    if (head === undefined) {
      const write = { ...op, kind: "insert" } as RemoteWrite;
      (MASTER_TABLES.includes(op.table) ? masterInserts : otherInserts).push({ op, write });
      continue;
    }
    const part =
      op.table === "items"
        ? winningItemPart(op.row, head)
        : wins(rowVersion(op), head.version)
          ? undefined
          : null;
    if (part === null) {
      settled.push(op);
      superseded += 1;
    } else {
      const base = { ...op, kind: "update", rowNumber: head.rowNumber };
      const write = (part === undefined ? base : { ...base, part }) as RemoteWrite;
      updates.push({ op, write });
    }
  }

  return {
    steps: [...masterInserts, ...updates, ...otherInserts, ...tombstones],
    settled,
    superseded,
  };
}
