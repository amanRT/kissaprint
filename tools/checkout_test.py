"""End-to-end test of the whole purchase in headless Chrome, against a private local server:

    product page (options, photo uploads) -> cart -> checkout (validation) -> payment (local stand-in)
    -> order page -> admin (sign-in, order, photos, .zip download, ship with tracking) -> track-order

Usage:
    python tools/build.py && python tools/checkout_test.py            # pass/fail per step
    python tools/checkout_test.py --shots                             # + screenshots in qa/checkout/
    python tools/checkout_test.py --supabase                          # use the Supabase project in .env

By default it uses a temporary order store, so your .data/ folder and real accounts are never touched.
--supabase stores the test order and its photos in your real Supabase project (marked "E2E Test"),
which proves uploads, signed links and the database work. Payments always use the fake payment step.
Exits non-zero if any step fails.
"""
import argparse
import hashlib
import os
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="kp-e2e-"))
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageDraw  # noqa: E402
from selenium.webdriver.common.by import By  # noqa: E402

from backend.config import load_dotenv, settings  # noqa: E402
from backend.store import make_store  # noqa: E402
from browser import make_driver, screenshot, set_viewport, wait_ready  # noqa: E402
from serve import start_background  # noqa: E402

failures = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)
    if not ok:
        failures.append(name)
    return ok


def until(fn, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            value = fn()
            if value:
                return value
        except Exception:  # noqa: BLE001 - element not there yet
            pass
        time.sleep(0.1)
    return None


def make_photos(n=3):
    paths = []
    for i, colour in enumerate(["#d7263d", "#ffe07a", "#d6e8ff", "#d3f0de"][:n]):
        img = Image.new("RGB", (1200, 1500), colour)
        ImageDraw.Draw(img).text((80, 80), f"KissaPrints test photo {i + 1}", fill="#1b1414")
        path = TMP / f"test-photo-{i + 1}.jpg"
        img.save(path, quality=88)
        paths.append(path)
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", action="store_true", help="save screenshots to qa/checkout/")
    ap.add_argument("--supabase", action="store_true", help="store the test order in the Supabase project from .env")
    args = ap.parse_args()
    # Explicit empty values win over .env (load_dotenv only fills in names that are missing).
    os.environ.update({"KP_DATA_DIR": str(TMP / "data"), "ADMIN_PASSWORD": "e2e-admin-pass", "RAZORPAY_KEY_ID": "", "RAZORPAY_KEY_SECRET": ""})
    if not args.supabase:
        os.environ.update({"SUPABASE_URL": "", "SUPABASE_SECRET_KEY": "", "SUPABASE_SERVICE_ROLE_KEY": ""})
    load_dotenv()
    cfg = settings()
    if args.supabase and cfg.storage != "supabase":
        sys.exit("--supabase: no working Supabase settings found in .env" + "".join(f"\n  ! {p}" for p in cfg.problems))
    print(f"Order store: {cfg.storage}" + (f" ({cfg.supabase_url})" if cfg.storage == "supabase" else ""))
    customer_name = "E2E Test" if args.supabase else "Aman Test"
    shots = ROOT / "qa" / "checkout"
    if args.shots:
        shots.mkdir(parents=True, exist_ok=True)
    server, base = start_background(ROOT / "dist")
    photos = make_photos()
    d = make_driver()
    js = d.execute_script
    q = lambda css: d.find_element(By.CSS_SELECTOR, css)  # noqa: E731
    click = lambda el: js("arguments[0].click()", el)  # noqa: E731 - DOM click: emulated viewport != window
    shot = lambda name: args.shots and screenshot(d, str(shots / f"{name}.png"))  # noqa: E731
    try:
        # ---------------------------------------------------------- shopper (phone)
        set_viewport(d, 390, 844, 2, True)
        d.get(base + "/products/classic-memoroids/")
        wait_ready(d)
        js("localStorage.clear()")
        d.refresh()
        wait_ready(d)
        click(q("input[value='30 prints']"))
        check("options update price and photos needed", until(lambda: q("[data-need-out]").text == "30" and "₹599" in q("[data-add]").text),
              q("[data-add]").text)
        q("[data-photo-input]").send_keys("\n".join(str(p) for p in photos))
        done = until(lambda: js("return [...document.querySelectorAll('.thumb')].every(t => t.dataset.state === 'done') && document.querySelectorAll('.thumb').length") == 3, 20)
        check("photos upload as soon as they're picked", done, q("[data-photo-status]").text)
        q("#note").send_keys("us, always")
        click(q('[data-qty] button[data-step="1"]'))
        js("document.querySelector('[data-dropzone]').scrollIntoView({block: 'center'})")
        time.sleep(0.3)
        shot("1-product")
        click(q("[data-add]"))
        check("add to cart opens the cart", until(lambda: js("return document.getElementById('cart-drawer').open")))
        check("cart line shows the photos", "3 of 30 photos added" in q(".cart-item__photos").get_attribute("textContent"),
              q(".cart-item__photos").get_attribute("textContent"))
        time.sleep(0.5)  # let the drawer finish sliding in
        shot("2-cart")

        click(q("#cart-drawer a[href='/checkout/']"))
        until(lambda: d.current_url.endswith("/checkout/"))
        wait_ready(d)
        lines = until(lambda: d.find_elements(By.CSS_SELECTOR, ".co-line"))
        total = until(lambda: q("[data-co-total]").get_attribute("textContent") if q("[data-co-total]").get_attribute("textContent") != "-" else "")
        check("checkout re-prices the cart on the server", lines and total == "₹1,198", f"{len(lines or [])} line(s), total {total}")
        check("pay button shows the amount", until(lambda: q("[data-pay]").is_enabled() and "₹1,198" in q("[data-pay]").text), q("[data-pay]").text)
        check("test-mode banner is visible", q("[data-test-banner]").is_displayed())
        fields = {"name": customer_name, "phone": "12345", "email": "aman@example.com", "line1": "Flat 4B, Rose Apartments",
                  "line2": "MG Road", "pincode": "411001", "city": "Pune"}
        for name, value in fields.items():
            q(f"[data-co-form] [name={name}]").send_keys(value)
        js("const s = document.querySelector('[name=state]'); s.value = 'Maharashtra'; s.dispatchEvent(new Event('change', {bubbles: true}))")
        click(q("[data-pay]"))
        err = until(lambda: q("[data-co-error]").text)
        check("invalid mobile number is caught", "mobile" in (err or "") and q("[name=phone]").get_attribute("aria-invalid") == "true", err)
        q("[name=phone]").clear()
        q("[name=phone]").send_keys("98765 43210")
        check("no sideways scrolling on mobile checkout", js("return document.documentElement.scrollWidth <= innerWidth"))
        shot("3-checkout")
        click(q("[data-pay]"))
        check("payment window opens", until(lambda: js("return !!document.querySelector('dialog.mock-pay[open]')")))
        shot("4-payment")
        click(q("dialog.mock-pay button[value=pay]"))
        until(lambda: "/order/" in d.current_url, 15)
        heading = until(lambda: q("[data-order-view] h1").text)
        check("order confirmation page", heading == f"Thank you, {customer_name.split()[0]}!", heading)
        params = parse_qs(urlsplit(d.current_url).query)
        order_id, token = params["id"][0], params["t"][0]
        check("timeline + missing-photos reminder", "3 of 30 received" in q(".order-note").text and len(d.find_elements(By.CSS_SELECTOR, ".timeline li")) == 4)
        check("cart is emptied after paying", js("return localStorage.getItem('kp-cart2')") is None)
        shot("5-confirmation")

        # ---------------------------------------------------------- team (laptop)
        set_viewport(d, 1440, 900, 1, False)
        d.get(base + "/admin/")
        until(lambda: q("[data-login]").is_displayed())
        q("[data-login-form] [name=password]").send_keys("wrong")
        click(q("[data-login-form] button"))
        check("wrong admin password is refused", until(lambda: q("[data-login-error]").text, 5), q("[data-login-error]").text)
        q("[data-login-form] [name=password]").clear()
        q("[data-login-form] [name=password]").send_keys("e2e-admin-pass")
        click(q("[data-login-form] button"))
        row = until(lambda: q(f"[data-order='{order_id}']"))
        check("new order appears in the dashboard", row and q("[data-count=new]").text == "1", order_id)
        shot("6-admin-list")
        click(row)
        loaded = until(lambda: js("return [...document.querySelectorAll('.adm-photos img')].filter(i => i.complete && i.naturalWidth > 0).length") == 3, 10)
        check("order detail shows the customer's photos", loaded)
        check("detail shows customer, caption and payment", all(s in q("[data-detail-body]").text for s in (customer_name, "+91 98765 43210", "us, always", "pay_mock")))
        shot("7-admin-order")

        downloads = TMP / "downloads"
        downloads.mkdir()
        d.execute_cdp_cmd("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(downloads)})
        click(q("[data-zip]"))
        archive = until(lambda: next((p for p in downloads.glob("*.zip")), None), 15)
        ok = False
        if archive:
            time.sleep(0.3)
            with zipfile.ZipFile(archive) as zf:
                got = sorted(hashlib.sha256(zf.read(n)).hexdigest() for n in zf.namelist())
                names = zf.namelist()
            ok = got == sorted(hashlib.sha256(p.read_bytes()).hexdigest() for p in photos)
        check("photos download as one .zip, byte-for-byte", ok, ", ".join(names) if archive else "no file")

        form = q("[data-update]")
        js("const s = arguments[0]; s.value = 'shipped'; s.dispatchEvent(new Event('change', {bubbles: true}))", form.find_element(By.NAME, "status"))
        for name, value in {"courier": "Delhivery", "number": "DL123456", "url": "https://www.delhivery.com/track/package/DL123456"}.items():
            form.find_element(By.NAME, name).send_keys(value)
        click(form.find_element(By.CSS_SELECTOR, "button[type=submit]"))
        check("status + tracking saved", until(lambda: "Shipped" in q(".adm-history").text and q(".adm-sum .adm-status").text.lower() == "shipped"))
        click(q("[data-detail] [data-close]"))

        # ---------------------------------------------------------- shopper tracks the order
        set_viewport(d, 390, 844, 2, True)
        d.get(base + "/track-order/")
        wait_ready(d)
        q("[data-track-form] [name=id]").send_keys(order_id.lower())
        q("[data-track-form] [name=contact]").send_keys("+91 98765 43210")
        click(q("[data-track-form] button"))
        heading = until(lambda: "/order/" in d.current_url and q("[data-order-view] h1").text, 10)
        tracked = d.find_elements(By.CSS_SELECTOR, ".order-track a[href*='delhivery']")
        check("track-order finds it, with the tracking link", heading == "Shipped" and tracked, heading)
        shot("8-tracking")

        errors = [e["message"] for e in d.get_log("browser") if e["level"] == "SEVERE"
                  and not any(ok in e["message"] for ok in ("/api/admin/me/", "/api/admin/login/"))]  # expected 401s
        check("no unexpected console errors", not errors, "; ".join(errors)[:300])
        stored = make_store(settings()).get_order(order_id)
        check(f"stored order ({cfg.storage}): priced by the server", (stored["total"], stored["items"][0]["unit_price"], stored["status"]) == (1198, 599, "shipped"))
        check("customer link token works", token == stored["token"])
    finally:
        d.quit()
        server.shutdown()
    print(f"\n{'All steps passed' if not failures else f'{len(failures)} step(s) failed'}" + (f" - screenshots in {shots}" if args.shots else ""))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
