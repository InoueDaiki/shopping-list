import { useCallback, useEffect, useRef, useState } from "react";

// 取り消せる間
const UNDO_MS = 5_000;

// 払って消した行は、少しの間だけ一覧から隠し、取り消せるようにする。消す(onCommit)のは時間が
// たったとき、次を消したとき、画面を離れたとき。墓石からの復活に頼らないので、取り消しが
// ほかの端末の同期とぶつからない。keyOf は隠す行の鍵
export function usePendingDelete<T>(onCommit: (target: T) => void, keyOf: (target: T) => string) {
  const [pending, setPending] = useState<T | null>(null);
  const pendingRef = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const target = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (target !== null) onCommitRef.current(target);
  }, []);

  const remove = useCallback(
    (target: T) => {
      commit();
      pendingRef.current = target;
      setPending(target);
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

  const hiddenKey: string | null = pending === null ? null : keyOf(pending);
  return { pending, hiddenKey, remove, undo };
}
