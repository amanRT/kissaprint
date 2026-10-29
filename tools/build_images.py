"""Crop + encode the lifestyle photos used directly on the site (hero, occasions, community wall...).

Usage: python tools/build_images.py
Reads design/source-photos/*.jpg (run tools/fetch_photos.py first) and writes
src/static/assets/img/photos/<name>-<width>.{avif,webp}.
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from imagekit import crop_to_aspect, encode_variants  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design" / "source-photos"
OUT = ROOT / "src" / "static" / "assets" / "img" / "photos"

SQUARE, PORTRAIT, LANDSCAPE, WIDE = 1.0, 4 / 5, 4 / 3, 16 / 9

# output name: (source photo, aspect, focal point, widths[, zoom])
PHOTOS = {
    # Tiny face crops for the "loved by" avatar stack
    "av-1": ("her-portrait", SQUARE, (0.5, 0.24), [96], 0.42),
    "av-2": ("him-turban", SQUARE, (0.5, 0.3), [96], 0.45),
    "av-3": ("her-saree", SQUARE, (0.55, 0.22), [96], 0.4),
    "av-4": ("him-kurta", SQUARE, (0.5, 0.2), [96], 0.42),
    # Hero polaroids + "make your memoroid" samples
    "pola-couple": ("couple-saree", SQUARE, (0.5, 0.2), [280, 560]),
    "pola-friends": ("friends-picnic", SQUARE, (0.5, 0.5), [280, 560]),
    "pola-pet": ("puppy", SQUARE, (0.5, 0.42), [280, 560]),
    "pola-holi": ("holi-couple", SQUARE, (0.5, 0.33), [280, 560]),
    "pola-family": ("family-newborn", SQUARE, (0.5, 0.27), [280, 560]),
    "pola-sunset": ("sunset", SQUARE, (0.45, 0.55), [280, 560]),
    # Shop by occasion (bento: one big landscape tile + square tiles)
    "occ-couples": ("couple-heritage", LANDSCAPE, (0.56, 0.45), [640, 1200]),
    "occ-her": ("her-portrait", SQUARE, (0.5, 0.3), [360, 640]),
    "occ-him": ("him-portrait", SQUARE, (0.5, 0.3), [360, 640]),
    "occ-friends": ("friends-picnic", SQUARE, (0.5, 0.5), [360, 640]),
    "occ-parents": ("family-newborn", SQUARE, (0.5, 0.3), [360, 640]),
    "occ-decor": ("ugc-stringlights", SQUARE, (0.42, 0.5), [360, 640]),
    # Community wall (#MyKissa)
    "ugc-wall": ("ugc-wall", SQUARE, (0.5, 0.45), [300, 560]),
    "ugc-instax": ("ugc-instax", SQUARE, (0.5, 0.5), [300, 560]),
    "ugc-hand": ("ugc-hand", SQUARE, (0.5, 0.45), [300, 560]),
    "ugc-yellow": ("ugc-yellow", SQUARE, (0.5, 0.6), [300, 560]),
    "ugc-frames": ("ugc-frames", SQUARE, (0.45, 0.5), [300, 560]),
    "ugc-hanging": ("ugc-hanging", SQUARE, (0.55, 0.5), [300, 560]),
    "ugc-table": ("ugc-table", SQUARE, (0.5, 0.4), [300, 560]),
    "ugc-bedroom": ("room-bedroom", SQUARE, (0.4, 0.5), [300, 560]),
    # Festive + gifting
    "festive-diyas": ("diya-flowers", WIDE, (0.5, 0.5), [640, 1200]),
    "gift-box": ("gift-green", PORTRAIT, (0.5, 0.45), [360, 640]),
    "gift-hands": ("gift-hands", SQUARE, (0.5, 0.5), [360, 640]),
    "gift-window": ("gift-window", PORTRAIT, (0.5, 0.55), [360, 640]),
    "about-friends": ("holi-friends", WIDE, (0.45, 0.45), [640, 1200]),
}


def main():
    for name, (src, aspect, focal, widths, *zoom) in PHOTOS.items():
        img = crop_to_aspect(Image.open(SRC / f"{src}.jpg"), aspect, focal, *zoom)
        print(f"{name:16} " + "  ".join(encode_variants(img, OUT, name, widths, group="photos")))


if __name__ == "__main__":
    main()
