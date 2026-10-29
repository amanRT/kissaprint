"""Subset + instance the brand fonts into small WOFF2 files and print fallback metric overrides.

Usage: python tools/build_fonts.py
Needs: fonttools, brotli
"""
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design" / "source-fonts"
OUT = ROOT / "src" / "static" / "assets" / "fonts"

# Basic Latin, Latin-1, dashes/quotes/bullets/ellipsis, rupee, arrows, trade mark, multiplication.
UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20B9, 0x2122, 0x2190, 0x2192, 0x2212]
)

FULL_FEATURES = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk", "case", "lnum", "tnum"]

FONTS = [
    # (source file, output name, axis limits, OpenType features to keep)
    ("BricolageGrotesque-VF.ttf", "bricolage.woff2", {"wdth": 100, "wght": (400, 800)}, FULL_FEATURES),
    ("InstrumentSerif-Italic.ttf", "instrument-serif-italic.woff2", None, FULL_FEATURES),
    # Handwriting accent for polaroid captions only: one weight, no contextual alternates.
    ("Caveat-VF.ttf", "caveat.woff2", {"wght": 600}, ["kern", "liga"]),
]

SAMPLE = "the quick brown fox jumps over the lazy dog personalised photo gifts printed with love in india"


def avg_width(font: TTFont, text: str) -> float:
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    widths = [hmtx[cmap[ord(c)]][0] for c in text if ord(c) in cmap]
    return sum(widths) / len(widths) / font["head"].unitsPerEm


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    arial = TTFont(r"C:\Windows\Fonts\arial.ttf")
    arial_w = avg_width(arial, SAMPLE)
    for src, out, limits, features in FONTS:
        font = TTFont(SRC / src, lazy=False)
        has_rupee = 0x20B9 in font.getBestCmap()
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = features
        opts.name_IDs = [1, 2, 3, 4, 6]
        opts.hinting = False
        opts.desubroutinize = True
        sub = subset.Subsetter(options=opts)
        sub.populate(unicodes=UNICODES)
        sub.subset(font)
        if limits:
            font = instancer.instantiateVariableFont(font, limits)
        font.flavor = "woff2"
        font.save(OUT / out)

        # Fallback metric overrides (to keep layout stable while the webfont swaps in).
        metrics_font = TTFont(SRC / src)
        upm = metrics_font["head"].unitsPerEm
        hhea = metrics_font["hhea"]
        size_adjust = avg_width(metrics_font, SAMPLE) / arial_w
        print(f"{out:32} {(OUT / out).stat().st_size / 1024:6.1f} KB  rupee={has_rupee}")
        print(f"    size-adjust: {size_adjust * 100:.2f}%; ascent-override: {hhea.ascent / upm / size_adjust * 100:.2f}%; "
              f"descent-override: {abs(hhea.descent) / upm / size_adjust * 100:.2f}%; "
              f"line-gap-override: {hhea.lineGap / upm / size_adjust * 100:.2f}%;")


if __name__ == "__main__":
    main()
