#!/usr/bin/env python3
# アプリのアイコンを作る(Pillow が要る)。色は design-tokens の明るい配色の primary に合わせる。
# 使い方: python3 scripts/gen-icon.py。出力は apps/mobile/assets
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SCALE = 4
PRIMARY = (190, 67, 162, 255)
WHITE = (255, 255, 255, 255)
OUT = Path(__file__).resolve().parent.parent / "apps/mobile/assets"


def foreground(zoom: float) -> Image.Image:
    # 買い物袋と、買った印のチェック。zoom は絵の大きさ(アダプティブアイコンの安全域に収める)
    canvas = SIZE * SCALE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def at(x: float, y: float) -> tuple[float, float]:
        return (canvas / 2 + (x - 512) * zoom * SCALE, canvas / 2 + (y - 512) * zoom * SCALE)

    def stroke(width: float) -> int:
        return round(width * zoom * SCALE)

    # 持ち手
    draw.arc([*at(362, 170), *at(662, 470)], 180, 360, fill=WHITE, width=stroke(56))
    # 袋
    draw.rounded_rectangle([*at(212, 320), *at(812, 880)], radius=stroke(96), fill=WHITE)
    # チェック
    points = [at(362, 600), at(472, 710), at(672, 490)]
    draw.line(points, fill=PRIMARY, width=stroke(76), joint="curve")
    for point in (points[0], points[-1]):
        r = stroke(38)
        draw.ellipse([point[0] - r, point[1] - r, point[0] + r, point[1] + r], fill=PRIMARY)
    return image.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    foreground(0.58).save(OUT / "adaptive-icon.png", optimize=True)
    full = Image.new("RGBA", (SIZE, SIZE), PRIMARY)
    full.alpha_composite(foreground(0.72))
    full.convert("RGB").save(OUT / "icon.png", optimize=True)


if __name__ == "__main__":
    main()
