// メモの文を、普通の文字と押せる URL に分ける

export interface MemoPart {
  text: string;
  url: boolean;
}

// URL は ASCII の文字まで(日本語の文が続いても URL に含めない)
const URL_RE = /https?:\/\/[\x21-\x7e]+/g;
// 文の終わりの句読点は URL に含めない
const TRAILING_RE = /[、。,.!?!?))」』]+$/;

export function splitMemo(memo: string): MemoPart[] {
  const parts: MemoPart[] = [];
  let rest = 0;
  for (const match of memo.matchAll(URL_RE)) {
    const url = match[0].replace(TRAILING_RE, "");
    if (match.index > rest) parts.push({ text: memo.slice(rest, match.index), url: false });
    parts.push({ text: url, url: true });
    rest = match.index + url.length;
  }
  if (rest < memo.length) parts.push({ text: memo.slice(rest), url: false });
  return parts;
}
