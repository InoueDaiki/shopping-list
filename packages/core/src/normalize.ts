const KATAKANA_TO_HIRAGANA = 0x60;

// カタカナの ァ〜ヶ と ヽヾ だけがひらがなと対応する。長音の ー はそのまま残す
function isConvertibleKatakana(code: number): boolean {
  return (code >= 0x30a1 && code <= 0x30f6) || code === 0x30fd || code === 0x30fe;
}

function katakanaToHiragana(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    result += isConvertibleKatakana(code)
      ? String.fromCharCode(code - KATAKANA_TO_HIRAGANA)
      : text[i];
  }
  return result;
}

// 品目名を比べるための形にする。NFKC で半角カナと全角英数字をそろえ、全角の空白も
// 普通の空白にしてから前後を除く
export function normalizeItemName(name: string): string {
  return katakanaToHiragana(name.normalize("NFKC").trim().toLowerCase());
}
