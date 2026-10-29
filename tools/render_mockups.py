"""Render the product mockups in design/mockups/studio.html to responsive AVIF + WebP images.

Usage:
    python tools/render_mockups.py                  # render every scene
    python tools/render_mockups.py star-map song-plaque
    python tools/render_mockups.py --grid-only      # just the preview sheet (design/renders/_grid.png)

Output: src/static/assets/img/products/<scene>-<width>.{avif,webp} and src/data/images.json entries.
"""
import argparse
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from browser import make_driver, screenshot, set_viewport, wait_ready  # noqa: E402
from imagekit import encode_variants  # noqa: E402
from serve import start_background  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "design"
RENDERS = DESIGN / "renders"
OUT = ROOT / "src" / "static" / "assets" / "img" / "products"
WIDTHS = [120, 360, 640, 800, 1200]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scenes", nargs="*")
    ap.add_argument("--grid-only", action="store_true")
    ap.add_argument("--encode-only", action="store_true", help="re-encode existing design/renders/*.png without a browser")
    args = ap.parse_args()
    RENDERS.mkdir(parents=True, exist_ok=True)
    if args.encode_only:
        for png in sorted(RENDERS.glob("*.png")):
            if png.stem.startswith("_") or png.stem in ("og", "icon") or (args.scenes and png.stem not in args.scenes):
                continue
            print(f"{png.stem:28} " + "  ".join(encode_variants(Image.open(png), OUT, png.stem, WIDTHS, group="products")))
        return
    server, base = start_background(DESIGN)
    driver = make_driver()
    try:
        # Preview sheet of every scene (for quick visual review).
        set_viewport(driver, 2480, 1300, 1)
        driver.get(f"{base}/mockups/studio.html?grid")
        wait_ready(driver)
        time.sleep(0.5)
        h = driver.execute_script("return document.documentElement.scrollHeight")
        set_viewport(driver, 2480, h, 1)
        time.sleep(0.3)
        screenshot(driver, RENDERS / "_grid.png")
        print("grid ->", RENDERS / "_grid.png")
        if args.grid_only:
            return

        set_viewport(driver, 600, 600, 2)
        driver.get(f"{base}/mockups/studio.html")
        wait_ready(driver)
        products = driver.execute_script(
            "return [...document.querySelectorAll('.scene:not([data-kind=brand])')].map(s => s.id)")
        brand = driver.execute_script("return [...document.querySelectorAll('.scene[data-kind=brand]')].map(s => s.id)")
        for sid in [s for s in products if not args.scenes or s in args.scenes]:
            driver.execute_script("location.hash = arguments[0]", sid)
            time.sleep(0.35)
            png = RENDERS / f"{sid}.png"
            screenshot(driver, png, clip={"x": 0, "y": 0, "width": 600, "height": 600})
            sizes = encode_variants(Image.open(png), OUT, sid, WIDTHS, group="products")
            print(f"{sid:28} " + "  ".join(sizes))
        for sid in [s for s in brand if not args.scenes or s in args.scenes]:
            render_brand(driver, sid)
    finally:
        driver.quit()
        server.shutdown()


def render_brand(driver, sid):
    """OG share image + app icons. Icons live at the site root so their URLs never change."""
    driver.execute_script("location.hash = arguments[0]", sid)
    time.sleep(0.2)
    w, h = driver.execute_script(
        "const r = document.getElementById(arguments[0]).getBoundingClientRect(); return [r.width, r.height]", sid)
    set_viewport(driver, int(w), int(h), 1)
    time.sleep(0.4)
    png = RENDERS / f"{sid}.png"
    screenshot(driver, png, clip={"x": 0, "y": 0, "width": int(w), "height": int(h)})
    img = Image.open(png).convert("RGB")
    static = ROOT / "src" / "static"
    if sid == "og":
        out = static / "assets" / "img" / "og-default.jpg"
        img.save(out, "JPEG", quality=86, optimize=True, progressive=True)
        print(f"{sid:28} {out.stat().st_size // 1024}K")
    elif sid == "icon":
        for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")]:
            img.resize((size, size), Image.LANCZOS).save(static / name, optimize=True)
        img.save(static / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
        print(f"{sid:28} icon-512/192, apple-touch-icon, favicon.ico")
    set_viewport(driver, 600, 600, 2)


if __name__ == "__main__":
    main()
