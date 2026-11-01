// デザイントークンの正。ここを変えたら `mise run gen` で generated/ を作り直す。
// 色は役割の名前で持つ(「ピンク」ではなく「主な操作」)。画面ではこの名前だけを使う。
// 明暗の両方の値を持ち、OS の設定で切り替える。書体は OS のものを使うので、トークンに持たない。
import { oklch, type Oklch } from "./color.ts";

export interface ColorToken {
  light: Oklch;
  dark: Oklch;
  // 使う場面。generated/TOKENS.md に載せ、AI と人が名前を選ぶときの手がかりにする
  usage: string;
}

// 配色は Catppuccin(MIT)を下敷きにする。明るい配色は Latte、暗い配色は Mocha。
// 色相は元の色のまま、文字とのコントラストが足りないところだけ明るさを調整する。
// - 地と文字は、わずかに紫に寄せた灰色
// - 主な操作はピンク。買い物のメモ帳のような明るさを、この色で作る
const COOL = 265; // Latte の base の色相
const INK = 279; // Latte の text の色相
const PINK = 338;
const PEACH = 45;
const GREEN = 145;
const RED = 20;

// カテゴリの札の、地と文字の組。明るさをそろえて色相を変える。
// 彩度の上限は色相ごとに違う(sRGB に収まる範囲)ので、組ごとに明と暗の彩度を渡す
function categoryBg(h: number, lightChroma: number, darkChroma: number, usage: string): ColorToken {
  return { light: oklch(0.93, lightChroma, h), dark: oklch(0.33, darkChroma, h), usage };
}

function categoryFg(h: number, lightChroma: number, darkChroma: number, usage: string): ColorToken {
  return { light: oklch(0.42, lightChroma, h), dark: oklch(0.87, darkChroma, h), usage };
}

export const colors = {
  // ---- 地と面 ----
  canvas: {
    light: oklch(0.958, 0.006, COOL),
    dark: oklch(0.243, 0.03, 284),
    usage: "画面の地",
  },
  surface: {
    light: oklch(0.995, 0.002, COOL),
    dark: oklch(0.285, 0.03, 283),
    usage: "品目の一覧、入力欄、カード、シートなど、地の上に置く面",
  },
  "surface-muted": {
    light: oklch(0.933, 0.009, COOL),
    dark: oklch(0.324, 0.032, 282),
    usage: "控えめな塗り(見出しの帯、押している行)",
  },
  "surface-strong": {
    light: oklch(0.885, 0.013, COOL),
    dark: oklch(0.385, 0.032, 280),
    usage: "控えめな塗りの上で押したとき",
  },

  // ---- 文字と線 ----
  fg: {
    light: oklch(0.38, 0.045, INK),
    dark: oklch(0.905, 0.035, 272),
    usage: "本文の文字",
  },
  "fg-muted": {
    light: oklch(0.49, 0.036, INK),
    dark: oklch(0.76, 0.04, 274),
    usage: "補足の文字(件数、入力の説明、買った品目)",
  },
  border: {
    light: oklch(0.9, 0.012, COOL),
    dark: oklch(0.37, 0.032, 282),
    usage: "区切り線、面の枠",
  },
  "border-strong": {
    light: oklch(0.62, 0.03, INK),
    dark: oklch(0.6, 0.034, 277),
    usage: "入力欄と、押せる部品の枠",
  },

  // ---- 主な操作 ----
  primary: {
    light: oklch(0.585, 0.19, PINK),
    dark: oklch(0.82, 0.105, PINK),
    usage: "主なボタンの塗り、選んでいる印",
  },
  "primary-pressed": {
    light: oklch(0.53, 0.18, PINK),
    dark: oklch(0.75, 0.125, PINK),
    usage: "主なボタンを押している間の塗り",
  },
  "on-primary": {
    light: oklch(1, 0, 0),
    dark: oklch(0.25, 0.04, PINK),
    usage: "primary の塗りの上の文字",
  },
  "primary-soft": {
    light: oklch(0.945, 0.03, PINK),
    dark: oklch(0.345, 0.06, PINK),
    usage: "主な色の淡い塗り(選んでいるチップ、知らせ)",
  },
  "primary-fg": {
    light: oklch(0.47, 0.15, PINK),
    dark: oklch(0.87, 0.075, 336),
    usage: "主な色の文字(primary-soft の上の文字)、選んでいる印の線、フォーカスの枠",
  },

  // ---- 差し色 ----
  accent: {
    light: oklch(0.57, 0.165, PEACH),
    dark: oklch(0.824, 0.101, 53),
    usage: "ピーチの差し色の塗り(新しいものの印、件数の印など、主な操作でないもの)",
  },
  "on-accent": {
    light: oklch(1, 0, 0),
    dark: oklch(0.25, 0.04, 53),
    usage: "accent の塗りの上の文字",
  },
  "accent-soft": {
    light: oklch(0.945, 0.028, PEACH),
    dark: oklch(0.34, 0.055, 53),
    usage: "差し色の淡い塗り。注意の知らせの地",
  },
  "accent-fg": {
    light: oklch(0.47, 0.13, PEACH),
    dark: oklch(0.86, 0.085, 53),
    usage: "差し色の文字。注意の文字",
  },

  // ---- 状態 ----
  success: {
    light: oklch(0.525, 0.15, GREEN),
    dark: oklch(0.82, 0.125, 143),
    usage: "買った。チェックの塗り",
  },
  "on-success": {
    light: oklch(1, 0, 0),
    dark: oklch(0.25, 0.04, 143),
    usage: "success の塗りの上の文字とチェックの印",
  },
  "success-soft": {
    light: oklch(0.945, 0.04, GREEN),
    dark: oklch(0.335, 0.05, 143),
    usage: "成功の淡い塗り",
  },
  "success-fg": {
    light: oklch(0.44, 0.12, GREEN),
    dark: oklch(0.86, 0.105, 143),
    usage: "成功の文字",
  },
  danger: {
    light: oklch(0.55, 0.21, RED),
    dark: oklch(0.756, 0.13, 3),
    usage: "削除など取り返しのつかない操作の塗り、入力の誤りの枠",
  },
  "on-danger": {
    light: oklch(1, 0, 0),
    dark: oklch(0.24, 0.04, 3),
    usage: "danger の塗りの上の文字",
  },
  "danger-soft": {
    light: oklch(0.945, 0.024, RED),
    dark: oklch(0.34, 0.06, 3),
    usage: "誤り・失敗の淡い塗り",
  },
  "danger-fg": {
    light: oklch(0.47, 0.18, RED),
    dark: oklch(0.85, 0.08, 3),
    usage: "誤り・失敗の文字",
  },

  // ---- カテゴリの札。どの組をどのカテゴリに当てるかは、売り場を思い出せるようにアプリが決める ----
  "cat-1": categoryBg(20, 0.03, 0.06, "カテゴリの札の地。赤系(生肉など)"),
  "cat-1-fg": categoryFg(20, 0.12, 0.06, "cat-1 の上の文字"),
  "cat-2": categoryBg(55, 0.04, 0.06, "カテゴリの札の地。ピーチ系(惣菜、パンなど)"),
  "cat-2-fg": categoryFg(55, 0.1, 0.07, "cat-2 の上の文字"),
  "cat-3": categoryBg(95, 0.06, 0.055, "カテゴリの札の地。クリーム系(乳製品など)"),
  "cat-3-fg": categoryFg(95, 0.085, 0.08, "cat-3 の上の文字"),
  "cat-4": categoryBg(145, 0.06, 0.06, "カテゴリの札の地。緑系(青果など)"),
  "cat-4-fg": categoryFg(145, 0.11, 0.08, "cat-4 の上の文字"),
  "cat-5": categoryBg(195, 0.05, 0.05, "カテゴリの札の地。青緑系(冷凍など)"),
  "cat-5-fg": categoryFg(195, 0.07, 0.07, "cat-5 の上の文字"),
  "cat-6": categoryBg(250, 0.032, 0.06, "カテゴリの札の地。青系(鮮魚など)"),
  "cat-6-fg": categoryFg(250, 0.11, 0.06, "cat-6 の上の文字"),
  "cat-7": categoryBg(300, 0.035, 0.06, "カテゴリの札の地。紫系(飲み物など)"),
  "cat-7-fg": categoryFg(300, 0.12, 0.065, "cat-7 の上の文字"),
  "cat-8": categoryBg(350, 0.04, 0.06, "カテゴリの札の地。ピンク系(日用品など)"),
  "cat-8-fg": categoryFg(350, 0.13, 0.07, "cat-8 の上の文字"),

  // ---- 重ね ----
  overlay: {
    light: oklch(0.3, 0.03, INK, 0.45),
    dark: oklch(0.12, 0.02, 284, 0.65),
    usage: "ダイアログとシートの後ろに敷く幕",
  },
} satisfies Record<string, ColorToken>;

export type ColorName = keyof typeof colors;

const categories = [1, 2, 3, 4, 5, 6, 7, 8] as const;

// 文字と地の組み合わせ。コントラスト比をテストで確かめる(src/tokens.test.ts)。
// min は WCAG 2 の AA(本文 4.5、部品の線 3)
export const contrastPairs: { fg: ColorName; bg: ColorName; min: number }[] = [
  ...(["canvas", "surface", "surface-muted"] as const).flatMap((bg) => [
    { fg: "fg" as const, bg, min: 4.5 },
    { fg: "fg-muted" as const, bg, min: 4.5 },
    { fg: "primary-fg" as const, bg, min: 4.5 },
    { fg: "accent-fg" as const, bg, min: 4.5 },
    { fg: "danger-fg" as const, bg, min: 4.5 },
    { fg: "success-fg" as const, bg, min: 4.5 },
  ]),
  { fg: "fg", bg: "surface-strong", min: 4.5 },
  { fg: "on-primary", bg: "primary", min: 4.5 },
  { fg: "on-primary", bg: "primary-pressed", min: 4.5 },
  { fg: "on-accent", bg: "accent", min: 4.5 },
  { fg: "on-success", bg: "success", min: 4.5 },
  { fg: "on-danger", bg: "danger", min: 4.5 },
  { fg: "primary-fg", bg: "primary-soft", min: 4.5 },
  { fg: "accent-fg", bg: "accent-soft", min: 4.5 },
  { fg: "success-fg", bg: "success-soft", min: 4.5 },
  { fg: "danger-fg", bg: "danger-soft", min: 4.5 },
  { fg: "fg", bg: "primary-soft", min: 4.5 },
  { fg: "fg", bg: "accent-soft", min: 4.5 },
  ...categories.map((n) => ({ fg: `cat-${n}-fg` as ColorName, bg: `cat-${n}` as ColorName, min: 4.5 })),
  // 線と、押せる部品の見分け
  { fg: "border-strong", bg: "surface", min: 3 },
  { fg: "primary", bg: "surface", min: 3 },
  { fg: "success", bg: "surface", min: 3 },
  { fg: "danger", bg: "surface", min: 3 },
];

// 角丸(rem)。Tailwind の rounded-sm / md / lg / xl になる。やわらかく見えるよう大きめにする
// 大きさで役割を分ける: sm は札とチェックボックス、md は入力欄、lg は面、xl はシートとダイアログ。
// ボタンとチップは rounded-full
export const radius = {
  sm: 0.375,
  md: 0.75,
  lg: 1,
  xl: 1.5,
};
