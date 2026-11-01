// 順番の手の編集。上下のボタンで隣と入れ替える
export function moveInOrder<T>(order: readonly T[], index: number, offset: -1 | 1): T[] {
  const target = index + offset;
  const next = [...order];
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}
