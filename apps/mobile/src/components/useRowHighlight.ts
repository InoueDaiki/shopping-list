import type { Id } from "@shopping-list/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FlatList } from "react-native";

import { itemRowIndex, type ListRow } from "../logic/listRows.ts";

const HIGHLIGHT_MS = 2000;
const RETRY_MS = 100;
const MAX_RETRIES = 3;

// 品目の行までスクロールし、少しの間だけ強調する。同じ行をもう一度指せば、強調の時間も延びる
export function useRowHighlight(rows: readonly ListRow[]) {
  const listRef = useRef<FlatList<ListRow>>(null);
  const rowsRef = useRef(rows);
  const retries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [target, setTarget] = useState<{ id: Id } | null>(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const scroll = useCallback((id: Id) => {
    const index = itemRowIndex(rowsRef.current, id);
    if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.5 });
  }, []);

  useEffect(() => {
    if (!target) return;
    retries.current = 0;
    scroll(target.id);
    const timer = setTimeout(() => setTarget(null), HIGHLIGHT_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(retryTimer.current);
    };
  }, [target, scroll]);

  // 行の高さが可変で、まだ描いていない行へは飛べない。だいたいの位置まで動かして描かせてから、やり直す
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
      if (!target || retries.current >= MAX_RETRIES) return;
      retries.current++;
      retryTimer.current = setTimeout(() => scroll(target.id), RETRY_MS);
    },
    [target, scroll],
  );

  const showRow = useCallback((id: Id) => setTarget({ id }), []);

  return { listRef, highlightId: target?.id ?? null, showRow, onScrollToIndexFailed };
}
