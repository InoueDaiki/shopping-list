import type { Id, Item } from "@shopping-list/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { repository } from "../data/runtime.ts";

// 取り消せる間
const UNDO_MS = 5_000;

// 払って消した品目は、少しの間だけ一覧から隠し、取り消せるようにする。消すのは時間が
// たったとき、次を消したとき、画面を離れたとき。墓石からの復活に頼らないので、取り消しが
// ほかの端末の同期とぶつからない
export function usePendingDelete() {
  const [pending, setPending] = useState<Item | null>(null);
  const pendingRef = useRef<Item | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const item = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (item) repository.deleteItem(item.id);
  }, []);

  const remove = useCallback(
    (item: Item) => {
      commit();
      pendingRef.current = item;
      setPending(item);
      timer.current = setTimeout(commit, UNDO_MS);
    },
    [commit],
  );

  const undo = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pendingRef.current = null;
    setPending(null);
  }, []);

  useEffect(() => commit, [commit]);

  const hiddenId: Id | null = pending?.id ?? null;
  return { pending, hiddenId, remove, undo };
}
