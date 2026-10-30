"""Visual QA: scroll through pages like a user, screenshot every viewport and flag common problems.

Usage:
    python tools/shoot.py                         # home + key templates, desktop + mobile
    python tools/shoot.py / /shop/ --viewports mobile
    python tools/shoot.py /products/song-plaque/ --full-sheet

Screens go to qa/screens/ (git-ignored). Checks: console errors, horizontal overflow, broken images,
images without alt text. Starts the built Next.js app itself, so run `npm run build` first.
"""
import argparse
import re
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from browser import make_driver, screenshot, set_viewport, wait_ready  # noqa: E402
from nextserver import start_next  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "qa" / "screens"
VIEWPORTS = {"desktop": (1440, 900, 1, False), "tablet": (820, 1180, 1, True), "mobile": (390, 844, 2, True)}
DEFAULT_PAGES = ["/", "/shop/", "/products/classic-memoroids/", "/gifts/for-couples/", "/about/", "/404.html"]

CHECKS_JS = r"""
const vw = document.documentElement.clientWidth, out = {};
out.overflow = document.documentElement.scrollWidth - vw;
out.wide = [...document.querySelectorAll('body *')].filter(el => {
  const r = el.getBoundingClientRect(); if (!r.width || r.right <= vw + 1) return false;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p); if (/(hidden|clip|auto|scroll)/.test(s.overflowX)) return false; }
  return true; }).slice(0, 8).map(el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' right=' + Math.round(el.getBoundingClientRect().right));
out.broken = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src).map(i => i.src.split('/').pop()).slice(0, 8);
out.noalt = [...document.images].filter(i => !i.hasAttribute('alt')).map(i => i.src.split('/').pop()).slice(0, 8);
return out;
"""


def slug(path):
    return re.sub(r"[^a-z0-9]+", "-", path.strip("/").lower()).strip("-") or "home"


def shoot(driver, base, path, vp, full_sheet):
    w, h, dpr, mobile = VIEWPORTS[vp]
    set_viewport(driver, w, h, dpr, mobile)
    driver.get(base + path)
    wait_ready(driver)
    # Walk the page once so lazy images load, then come back to the top.
    total = driver.execute_script("return document.documentElement.scrollHeight")
    for y in range(0, total, h // 2):
        driver.execute_script("window.scrollTo(0, arguments[0])", y)
        time.sleep(0.06)
    driver.execute_script("window.scrollTo(0, 0)")
    wait_ready(driver)
    time.sleep(0.4)
    total = driver.execute_script("return document.documentElement.scrollHeight")
    frames = []
    step = h - 80  # small overlap between frames
    for i, y in enumerate(range(0, total, step)):
        driver.execute_script("window.scrollTo(0, arguments[0])", y)
        time.sleep(0.35)
        f = OUT / f"{slug(path)}-{vp}-{i:02d}.png"
        screenshot(driver, f)
        frames.append(f)
        # content-visibility can shrink the page as sections render, so stop at the real bottom
        if driver.execute_script("return window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2"):
            break
    checks = driver.execute_script(CHECKS_JS)
    logs = [e["message"] for e in driver.get_log("browser") if e["level"] in ("SEVERE", "WARNING")]
    # Mobile frames: stitch three-up sheets for quicker review.
    if mobile or full_sheet:
        per = 3 if mobile else 1
        for s in range(0, len(frames), per):
            imgs = [Image.open(f) for f in frames[s:s + per]]
            sheet = Image.new("RGB", (sum(i.width for i in imgs) + 24 * (len(imgs) - 1), max(i.height for i in imgs)), "#888")
            x = 0
            for im in imgs:
                sheet.paste(im, (x, 0))
                x += im.width + 24
            sheet.save(OUT / f"{slug(path)}-{vp}-sheet{s // per:02d}.png")
    return len(frames), total, checks, logs


def interactions(driver, base):
    """Drive the interactive pieces (menus, dialogs, cart, maker) and screenshot each state."""
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.by import By

    def snap(name):
        time.sleep(0.6)
        screenshot(driver, OUT / f"ui-{name}.png")
        print(f"  ui-{name}.png")

    set_viewport(driver, 1440, 900, 1)
    driver.get(base + "/")
    wait_ready(driver)
    ActionChains(driver).move_to_element(driver.find_element(By.CSS_SELECTOR, "[aria-controls=mega-shop]")).perform()
    snap("mega-shop")
    ActionChains(driver).move_to_element(driver.find_element(By.CSS_SELECTOR, "[aria-controls=mega-gifts]")).perform()
    snap("mega-gifts")
    ActionChains(driver).move_by_offset(0, 600).perform()
    driver.find_element(By.CSS_SELECTOR, "[data-open=search-dialog]").click()
    driver.find_element(By.CSS_SELECTOR, "[data-search-input]").send_keys("memo")
    snap("search")
    driver.execute_script("document.getElementById('search-dialog').close()")
    # Maker: vintage style + new caption
    driver.execute_script("document.querySelector('[data-maker]').scrollIntoView({block: 'center'})")
    jsclick = lambda css: driver.execute_script("document.querySelector(arguments[0]).click()", css)
    jsclick("input[name=style][value=vintage]")
    jsclick("input[name=photo][value=pola-pet]")
    cap = driver.find_element(By.ID, "maker-caption")
    cap.clear()
    cap.send_keys("best boy bruno")
    snap("maker")
    # Product page: choose options, add to cart -> drawer opens
    driver.get(base + "/products/classic-memoroids/")
    wait_ready(driver)
    jsclick("input[name=opt1][value=\"20 prints\"]")
    jsclick("[data-add]")
    snap("cart")
    # Mobile menu
    set_viewport(driver, 390, 844, 2, True)
    driver.get(base + "/")
    wait_ready(driver)
    driver.find_element(By.CSS_SELECTOR, "[data-open=menu-drawer]").click()
    snap("mobile-menu")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", nargs="*", default=DEFAULT_PAGES)
    ap.add_argument("--viewports", nargs="*", default=["desktop", "mobile"], choices=list(VIEWPORTS))
    ap.add_argument("--full-sheet", action="store_true")
    ap.add_argument("--interactions", action="store_true", help="screenshot menus, dialogs, cart and maker states")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.interactions:
        server, base = start_next()
        driver = make_driver()
        try:
            interactions(driver, base)
            logs = [e["message"] for e in driver.get_log("browser") if e["level"] == "SEVERE"]
            print("console errors:", logs or "none")
        finally:
            driver.quit()
            server.terminate()
        return
    for old in OUT.glob("*.png"):
        if any(old.name.startswith(slug(p) + "-") for p in args.pages):
            old.unlink()
    server, base = start_next()
    driver = make_driver()
    problems = 0
    try:
        for path in args.pages:
            for vp in args.viewports:
                n, total, checks, logs = shoot(driver, base, path, vp, args.full_sheet)
                flag = []
                if checks["overflow"] > 0:
                    flag.append(f"overflow {checks['overflow']}px {checks['wide']}")
                if checks["broken"]:
                    flag.append(f"broken {checks['broken']}")
                if checks["noalt"]:
                    flag.append(f"no-alt {checks['noalt']}")
                if logs:
                    flag.append(f"console {logs[:3]}")
                problems += bool(flag)
                print(f"{path:34} {vp:8} {n:2} frames, {total:5}px  " + ("OK" if not flag else " | ".join(flag)))
    finally:
        driver.quit()
        server.terminate()
    print(f"screens -> {OUT}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
