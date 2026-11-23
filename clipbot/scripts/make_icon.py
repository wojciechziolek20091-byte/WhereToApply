"""Draw the app icon (a green rounded square with a dark play mark).

    uv run python scripts/make_icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "assets"
GREEN, DARK = (62, 207, 142, 255), (12, 16, 14, 255)


def draw(size: int) -> Image.Image:
    s = size * 4  # draw large, then shrink for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = s * 0.06
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=s * 0.22, fill=GREEN)
    cx, cy, r = s * 0.53, s * 0.5, s * 0.2
    d.polygon([(cx - r * 0.8, cy - r), (cx - r * 0.8, cy + r), (cx + r, cy)], fill=DARK)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    big = draw(256)
    big.save(OUT / "clipbot.png")
    big.save(OUT / "clipbot.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64),
                                        (128, 128), (256, 256)])
    print("wrote", OUT / "clipbot.png", OUT / "clipbot.ico")
