// 行の ID。シートの ID の形(^[A-Za-z0-9_-]{1,64}$)に収まる、126 ビットの乱数の文字列
import { getRandomBytes } from "expo-crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function newId(): string {
  let id = "";
  for (const byte of getRandomBytes(21)) id += ALPHABET[byte & 63];
  return id;
}
