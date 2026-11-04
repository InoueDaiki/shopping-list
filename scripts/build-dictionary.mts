// 生成した語彙を packages/core/src/inference-dictionary-extra.ts に書き出す。
// 使い方: node scripts/build-dictionary.mts <語のディレクトリ>
// ディレクトリには「<カテゴリ名>.txt」を1行1語で置く。今のファイルの語に足し、正規化して並べ直す。
// 手で整えた辞書(inference-dictionary.ts)にある語と、2つのカテゴリに出た語は入れない
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { INFERENCE_DICTIONARY } from "../packages/core/src/inference-dictionary.ts";
import { normalizeItemName } from "../packages/core/src/normalize.ts";

const OUTPUT = new URL("../packages/core/src/inference-dictionary-extra.ts", import.meta.url);
const MIN_LENGTH = 2;
const MAX_LENGTH = 24;

async function currentExtra(): Promise<Record<string, string>> {
  if (!existsSync(OUTPUT)) return {};
  const module = await import(OUTPUT.href);
  return module.INFERENCE_DICTIONARY_EXTRA;
}

// テンプレート文字列に入れられ、品目名として引ける形の語だけを残す
function usable(word: string): boolean {
  return word.length >= MIN_LENGTH && word.length <= MAX_LENGTH && !/[\s`$\\]/.test(word) && !/^\d+$/.test(word);
}

const inputDir = process.argv[2];
if (!inputDir) {
  console.error("使い方: node scripts/build-dictionary.mts <語のディレクトリ>");
  process.exit(1);
}

const categories = Object.keys(INFERENCE_DICTIONARY);
const curated = new Set(Object.values(INFERENCE_DICTIONARY).flat().map(normalizeItemName));
const extra = await currentExtra();

const candidates = new Map<string, Set<string>>();
for (const category of categories) {
  candidates.set(category, new Set((extra[category] ?? "").split("\n").filter((word) => word !== "")));
}
for (const file of readdirSync(inputDir).filter((name) => name.endsWith(".txt"))) {
  const category = basename(file, ".txt");
  const words = candidates.get(category);
  if (!words) {
    console.error(`知らないカテゴリ: ${category}`);
    process.exit(1);
  }
  for (const line of readFileSync(join(inputDir, file), "utf8").split("\n")) words.add(normalizeItemName(line));
}

// 2つのカテゴリに出た語は、どちらにも入れない
const owners = new Map<string, number>();
for (const words of candidates.values()) for (const word of words) owners.set(word, (owners.get(word) ?? 0) + 1);

const stats = { curated: 0, ambiguous: 0, unusable: 0 };
const sections = categories.map((category) => {
  const words: string[] = [];
  for (const word of candidates.get(category) ?? []) {
    if (word === "") continue;
    if (!usable(word)) stats.unusable += 1;
    else if (curated.has(word)) stats.curated += 1;
    else if ((owners.get(word) ?? 0) > 1) stats.ambiguous += 1;
    else words.push(word);
  }
  words.sort();
  const key = /^[\p{L}\p{N}_]+$/u.test(category) ? category : JSON.stringify(category);
  return { line: `  ${key}: \`\n${words.join("\n")}\n\`,`, count: words.length, category };
});

writeFileSync(
  OUTPUT,
  [
    "// カテゴリの推定に使う、生成した語彙。scripts/build-dictionary.mts で書き出す。手で直さない。",
    "// 語は正規化した形(カタカナはひらがな)で、1行1語。起動の後に5万語を正規化し直さずに済むよう、",
    "// この形で持つ。手で整えた inference-dictionary.ts にある語は入れず、引くときもそちらを優先する",
    "export const INFERENCE_DICTIONARY_EXTRA: Readonly<Record<string, string>> = {",
    ...sections.map((section) => section.line),
    "};",
    "",
  ].join("\n"),
);

for (const section of sections) console.log(`${section.category}\t${section.count}`);
console.log(`合計\t${sections.reduce((sum, section) => sum + section.count, 0)}`);
console.log(`除いた語: 手の辞書と重複 ${stats.curated}、カテゴリが2つ ${stats.ambiguous}、形が不適 ${stats.unusable}`);
