// OKLCH の色と、sRGB(HEX)への変換・コントラスト比。
// CSS(Uniwind のテーマ)には OKLCH のまま書き、JS で使う React Native の値は HEX で渡す。
// 式は CSS Color 4 の OKLab の定義(https://www.w3.org/TR/css-color-4/#color-conversion-code)による

export interface Oklch {
  l: number;
  c: number;
  h: number;
  alpha: number;
}

export function oklch(l: number, c: number, h: number, alpha = 1): Oklch {
  return { l, c, h, alpha };
}

export function toCss({ l, c, h, alpha }: Oklch): string {
  const base = `${round(l, 3)} ${round(c, 3)} ${round(h, 1)}`;
  return alpha === 1 ? `oklch(${base})` : `oklch(${base} / ${round(alpha, 2)})`;
}

// 0〜1 に丸める前の、線形の sRGB
export function toLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

// sRGB の範囲に収まっているか(収まらないと、端末ごとに見え方がずれる)
export function inSrgbGamut(color: Oklch, epsilon = 0.002): boolean {
  return toLinearSrgb(color).every((v) => v >= -epsilon && v <= 1 + epsilon);
}

export function toHex(color: Oklch): string {
  const channels = toLinearSrgb(color).map((v) => {
    const x = Math.min(1, Math.max(0, v));
    const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
  if (color.alpha !== 1) {
    channels.push(Math.round(color.alpha * 255));
  }
  return `#${channels.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// WCAG 2 の相対輝度とコントラスト比。半透明の色は背景に重ねてから測る
function luminance([r, g, b]: [number, number, number]): number {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

export function contrastRatio(fg: Oklch, bg: Oklch): number {
  const bgRgb = toLinearSrgb(bg);
  // 線形の空間で重ねる(端末の合成とは少し違うが、判定の目安には足りる)
  const fgRgb = toLinearSrgb(fg).map((v, i) => v * fg.alpha + bgRgb[i]! * (1 - fg.alpha)) as [number, number, number];
  const [hi, lo] = [luminance(fgRgb), luminance(bgRgb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function round(v: number, digits: number): number {
  return Number(v.toFixed(digits));
}
