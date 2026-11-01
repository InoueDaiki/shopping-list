// 送信待ちを、リモートへの書き込みに変える。副作用の無い計算だけを置く。

import type { Iso } from "../types.ts";
import { changeId, changeKey, compareIso, rowVersion } from "./rows.ts";
import type {
  MutableTable,
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

function newestFirst(a: RemoteRowRef, b: RemoteRowRef): number {
  if (a.version !== null && b.version !== null) {
    const order = compareIso(b.version, a.version);
    if (order !== 0) return order;
  }
  return a.rowNumber - b.rowNumber;
}

export interface PushPlan {
  writes: RemoteWrite[];
  written: number;
  // 後勝ちで負けた操作の数。リモートの値は続く pull で取り込む
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

  const masterInserts: RemoteWrite[] = [];
  const updates: RemoteWrite[] = [];
  const otherInserts: RemoteWrite[] = [];
  const deletes: { table: MutableTable; rowNumber: number }[] = [];
  let written = 0;
  let superseded = 0;

  for (const op of ops) {
    if (op.action === "put" && op.table === "history") {
      otherInserts.push({ kind: "insert", table: op.table, row: op.row });
      written += 1;
      continue;
    }
    const table = op.table as MutableTable;
    const refs = [...(refsByKey.get(`${table}\0${changeId(op)}`) ?? [])].sort(newestFirst);
    const [head, ...duplicates] = refs;
    // 送り直しなどで同じ ID の行が重なっていたら、ここで1行に戻す
    for (const ref of duplicates) {
      deletes.push({ table, rowNumber: ref.rowNumber });
    }

    if (op.action === "delete") {
      if (head === undefined) continue;
      if (wins(op.at, head.version)) {
        deletes.push({ table, rowNumber: head.rowNumber });
        written += 1;
      } else {
        superseded += 1;
      }
      continue;
    }

    if (head === undefined) {
      const write = { ...op, kind: "insert" } as RemoteWrite;
      (MASTER_TABLES.includes(table) ? masterInserts : otherInserts).push(write);
      written += 1;
    } else if (wins(rowVersion(op), head.version)) {
      updates.push({ ...op, kind: "update", rowNumber: head.rowNumber } as RemoteWrite);
      written += 1;
    } else {
      superseded += 1;
    }
  }

  // 行を消すと後ろの行がずれるので、最後に、後ろの行から消す
  deletes.sort((a, b) => a.table.localeCompare(b.table) || b.rowNumber - a.rowNumber);
  return {
    writes: [
      ...masterInserts,
      ...updates,
      ...otherInserts,
      ...deletes.map((d): RemoteWrite => ({ kind: "delete", ...d })),
    ],
    written,
    superseded,
  };
}
