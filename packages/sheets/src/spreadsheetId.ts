// 貼られた URL か、QR コードの ID から、スプレッドシートの ID を取り出す。

const URL_RE =
  /^(?:https?:\/\/)?docs\.google\.com\/(?:[\w-]+\/\d+\/)?spreadsheets\/(?:u\/\d+\/)?d\/(?!e\/)([A-Za-z0-9_-]+)/;
// ID だけを渡されたとき。短い文字列は誤入力として扱う
const ID_RE = /^[A-Za-z0-9_-]{25,}$/;

export function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  return URL_RE.exec(trimmed)?.[1] ?? (ID_RE.test(trimmed) ? trimmed : null);
}
