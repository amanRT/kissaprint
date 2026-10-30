"""End-to-end test of the whole shop in headless Chrome, against the built Next.js app (`npm run build` first):

    sign up -> product page (options, photo uploads) -> cart -> checkout (validation, prefill) -> payment
    (local stand-in) -> order page -> "Your account" -> /admin/ refused for customers -> admin log-in ->
    dashboard (order, photos, .zip download, ship with tracking) -> guest track-order

Usage:
    python tools/checkout_test.py            # pass/fail per step
    python tools/checkout_test.py --shots    # + screenshots in qa/checkout/
    python tools/checkout_test.py --supabase # use the Supabase project in .env (leaves "E2E Test" records)

With --supabase the test order and two accounts stay behind (passwords are random and never shown). Remove them in
Supabase's SQL Editor: delete from public.users where email like 'e2e-%@example.com'; then delete the test order
in /admin/.

By default it runs with a temporary order store, so your .data/ folder and real accounts are never touched.
Payments always use the fake payment step. Exits non-zero if any step fails.
"""
import argparse
import hashlib
import json
import os
import secrets
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="kp-e2e-"))
sys.path.insert(0, str(ROOT / "tools"))

from PIL import Image, ImageDraw  # noqa: E402
from selenium.webdriver.common.by import By  # noqa: E402

from browser import make_driver, screenshot, set_viewport, wait_ready  # noqa: E402
from nextserver import run_node, start_next  # noqa: E402

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


def status_of(url):
    try:
        return urllib.request.urlopen(url, timeout=10).status
    except urllib.error.HTTPError as exc:
        return exc.code


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", action="store_true", help="save screenshots to qa/checkout/")
    ap.add_argument("--supabase", action="store_true", help="store the test order in the Supabase project from .env")
    args = ap.parse_args()
    # Explicit empty values win over .env (Next.js and our scripts only fill in names that are missing).
    env = {"KP_DATA_DIR": str(TMP / "data"), "JWT_SECRET": secrets.token_urlsafe(40), "RAZORPAY_KEY_ID": "", "RAZORPAY_KEY_SECRET": "",
           "KP_NO_DOTENV": "" if args.supabase else "1"}
    if not args.supabase:
        env.update({"SUPABASE_URL": "", "SUPABASE_SECRET_KEY": "", "SUPABASE_SERVICE_ROLE_KEY": "", "NEXT_PUBLIC_SUPABASE_URL": ""})
    tag = secrets.token_hex(3)
    # Fresh random passwords every run: with --supabase these accounts (one of them an admin) stay in the real
    # database, and this repo is public, so a fixed password here would be a way into the dashboard.
    shopper = {"name": "E2E Test" if args.supabase else "Aman Test", "email": f"e2e-shopper-{tag}@example.com", "password": secrets.token_urlsafe(18)}
    admin = {"email": f"e2e-admin-{tag}@example.com", "password": secrets.token_urlsafe(18)}
    made = run_node(str(ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs"), "scripts/create-admin.ts", "--email", admin["email"],
                    "--name", "E2E Admin", "--password", admin["password"], env=env, check=False)
    check("create-admin script", made.returncode == 0, (made.stdout or made.stderr).strip()[:120])

    shots = ROOT / "qa" / "checkout"
    if args.shots:
        shots.mkdir(parents=True, exist_ok=True)
    server, base = start_next(env=env)
    health = json.loads(urllib.request.urlopen(base + "/api/health/").read())
    print(f"Order store: {health['storage']} | payments: {health['payments']}")
    photos = make_photos()
    d = make_driver()
    js = d.execute_script
    q = lambda css: d.find_element(By.CSS_SELECTOR, css)  # noqa: E731
    click = lambda el: js("arguments[0].click()", el)  # noqa: E731 - DOM click: emulated viewport != window
    shot = lambda name: args.shots and screenshot(d, str(shots / f"{name}.png"))  # noqa: E731
    fetch_status = lambda path: js("return fetch(arguments[0]).then(r => r.status)", path)  # noqa: E731

    def fill(form_css, values):
        for name, value in values.items():
            el = q(f"{form_css} [name={name}]")
            el.clear()
            el.send_keys(value)

    try:
        check("admin API refuses anonymous visitors", status_of(base + "/api/admin/orders/") == 401)

        # ---------------------------------------------------------- shopper (phone): sign up, then shop
        set_viewport(d, 390, 844, 2, True)
        d.get(base + "/account/")
        check("account page needs a log-in", until(lambda: "/login/" in d.current_url), d.current_url.replace(base, ""))
        path = lambda: urlsplit(d.current_url).path  # noqa: E731
        d.get(base + "/products/classic-memoroids/")
        check("signed out, the product page asks to log in before adding photos",
              until(lambda: q("[data-login-to-upload]").is_displayed() and "Log in to order" in q("[data-login-to-buy]").text, 15))
        # Ordering needs an account (like Amazon): checkout sends signed-out shoppers to log in, then back.
        d.get(base + "/checkout/")
        check("checkout needs a log-in", until(lambda: path() == "/login/" and "next=%2Fcheckout%2F" in d.current_url), d.current_url.replace(base, ""))
        notice = until(lambda: q(".auth__notice").text, 8)
        check("…and says the cart is saved", bool(notice) and "cart is saved" in notice, notice)
        check("order API refuses signed-out shoppers", fetch_status("/api/orders/") == 401)
        js("localStorage.clear()")
        click(q(".auth__alt a"))  # "Create an account" keeps ?next=
        until(lambda: path() == "/signup/")
        wait_ready(d)
        fill("form", shopper)
        click(q("form button[type=submit]"))
        check("sign-up goes straight back to checkout", until(lambda: path() == "/checkout/", 15), d.current_url.replace(base, ""))
        d.get(base + "/account/")
        heading = until(lambda: path() == "/account/" and q("h1").text, 15)
        check("sign-up logs the customer in", heading == f"Hi, {shopper['name'].split()[0]}", heading)
        d.get(base + "/admin/")
        check("customers can't open /admin/ - sent to the homepage", until(lambda: path() == "/"), d.current_url.replace(base, ""))
        check("…and keep their session", any(c["name"] == "kp_session" for c in d.get_cookies()))
        check("admin API answers 403 for customers", fetch_status("/api/admin/orders/") == 403)

        d.get(base + "/products/classic-memoroids/")
        wait_ready(d)
        click(q("input[value='30 prints']"))
        check("options update price and photos needed", until(lambda: q("[data-need-out]").text == "30" and "₹599" in q("[data-add]").text), q("[data-add]").text)
        q("[data-photo-input]").send_keys("\n".join(str(p) for p in photos))
        done = until(lambda: js("return [...document.querySelectorAll('.thumb')].every(t => t.dataset.state === 'done') && document.querySelectorAll('.thumb').length") == 3, 30)
        check("photos upload as soon as they're picked", done, q("[data-photo-status]").text)
        q("#note").send_keys("us, always")
        click(q('[data-qty] button[data-step="1"]'))
        js("document.querySelector('[data-dropzone]').scrollIntoView({block: 'center'})")
        time.sleep(0.3)
        shot("1-product")
        click(q("[data-add]"))
        check("add to cart opens the cart", until(lambda: js("return document.getElementById('cart-drawer').open")))
        check("the cart is saved to the account", until(lambda: len(js("return fetch('/api/cart/').then(r => r.json())").get("items", [])) == 1, 10))
        note = until(lambda: q(".cart-item__photos").get_attribute("textContent"))
        check("cart line shows the photos", "3 of 30 photos added" in (note or ""), note)
        time.sleep(0.5)  # let the drawer finish sliding in
        shot("2-cart")

        click(q("#cart-drawer a[href='/checkout/']"))
        until(lambda: d.current_url.endswith("/checkout/"))
        wait_ready(d)
        total = until(lambda: q("[data-co-total]").get_attribute("textContent") if q("[data-co-total]").get_attribute("textContent") != "-" else "")
        check("checkout re-prices the cart on the server", total == "₹1,198", f"total {total}")
        check("checkout prefills the signed-in customer", until(lambda: q("[name=email]").get_attribute("value") == shopper["email"]))
        check("pay button shows the amount", until(lambda: q("[data-pay]").is_enabled() and "₹1,198" in q("[data-pay]").text), q("[data-pay]").text)
        check("test-mode banner is visible", q("[data-test-banner]").is_displayed())
        fill("[data-co-form]", {"phone": "12345", "line1": "Flat 4B, Rose Apartments", "line2": "MG Road", "pincode": "411001", "city": "Pune"})
        js("const s = document.querySelector('[name=state]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;"
           " set.call(s, 'Maharashtra'); s.dispatchEvent(new Event('change', {bubbles: true}))")
        click(q("[data-pay]"))
        err = until(lambda: q("[data-co-error]").text)
        check("invalid mobile number is caught", "mobile" in (err or "") and q("[name=phone]").get_attribute("aria-invalid") == "true", err)
        fill("[data-co-form]", {"phone": "98765 43210"})
        check("no sideways scrolling on mobile checkout", js("return document.documentElement.scrollWidth <= innerWidth"))
        shot("3-checkout")
        click(q("[data-pay]"))
        check("payment window opens", until(lambda: js("return !!document.querySelector('dialog.mock-pay[open]')"), 15))
        # Cancel first: no order for the customer, the cart keeps everything, and paying later still works.
        click(q("dialog.mock-pay button[value=cancel]"))
        check("cancelling the payment says so", until(lambda: "cancelled" in q("[data-co-error]").text.lower(), 10), q("[data-co-error]").text)
        check("…and keeps the cart", len(js("return fetch('/api/cart/').then(r => r.json())").get("items", [])) == 1)
        d.get(base + "/account/")
        check("a cancelled checkout isn't listed under Your orders", until(lambda: "No orders yet" in q(".account").text), q(".account").text[:120])
        d.get(base + "/checkout/")
        wait_ready(d)
        until(lambda: q("[data-pay]").is_enabled() and "₹1,198" in q("[data-pay]").text, 20)
        click(q("[data-pay]"))
        check("paying after a cancel opens the payment window again", until(lambda: js("return !!document.querySelector('dialog.mock-pay[open]')"), 15))
        shot("4-payment")
        click(q("dialog.mock-pay button[value=pay]"))
        until(lambda: "/order/" in d.current_url, 20)
        heading = until(lambda: q("[data-order-view] h1").text, 15)
        check("order confirmation page", heading == f"Thank you, {shopper['name'].split()[0]}!", heading)
        params = parse_qs(urlsplit(d.current_url).query)
        order_id, token = params["id"][0], params["t"][0]
        check("timeline + missing-photos reminder", "3 of 30 received" in q(".order-note").text and len(d.find_elements(By.CSS_SELECTOR, ".timeline li")) == 4)
        saved = js("return fetch('/api/cart/').then(r => r.json())")
        check("cart (kept on the account) is emptied after paying", saved.get("items") == [], str(saved)[:80])
        check("nothing is stored in localStorage", js("return localStorage.length") == 0, js("return Object.keys(localStorage)"))
        jar = d.get_cookies()
        check("exactly one cookie: the HttpOnly session", [c["name"] for c in jar] == ["kp_session"] and jar[0].get("httpOnly"), [(c["name"], c.get("httpOnly")) for c in jar])
        shot("5-confirmation")
        d.get(base + "/account/")
        check("the order shows under Your account", until(lambda: order_id in q(".account__orders").text))
        shot("6-account")
        click(until(lambda: next(b for b in d.find_elements(By.CSS_SELECTOR, "button") if b.text == "Log out")))
        check("log out", until(lambda: "/login/" in d.current_url))

        # ---------------------------------------------------------- team (laptop)
        set_viewport(d, 1440, 900, 1, False)
        d.get(base + "/admin/")
        check("/admin/ sends visitors to log in", until(lambda: "/login/" in d.current_url and "next=%2Fadmin%2F" in d.current_url), d.current_url.replace(base, ""))
        fill("form", {"email": admin["email"], "password": "wrong-password"})
        click(q("form button[type=submit]"))
        check("wrong admin password is refused", until(lambda: q(".co-error").text, 8), q(".co-error").text)
        fill("form", admin)
        click(q("form button[type=submit]"))
        row = until(lambda: q(f"[data-order='{order_id}']"), 15)
        check("admin log-in opens the dashboard with the new order", row and q("#tab-new .adm-count").text == "1", order_id)
        shot("7-admin-list")
        click(row)
        loaded = until(lambda: js("return [...document.querySelectorAll('.adm-photos img')].filter(i => i.complete && i.naturalWidth > 0).length") == 3, 15)
        check("order detail shows the customer's photos", loaded)
        check("detail shows customer, caption and payment", all(s in q("[data-detail-body]").text for s in (shopper["name"], "+91 98765 43210", "us, always", "pay_mock")))
        shot("8-admin-order")

        downloads = TMP / "downloads"
        downloads.mkdir()
        d.execute_cdp_cmd("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(downloads)})
        click(q("[data-zip]"))
        archive = until(lambda: next((p for p in downloads.glob("*.zip")), None), 20)
        ok, names = False, []
        if archive:
            time.sleep(0.3)
            with zipfile.ZipFile(archive) as zf:
                got = sorted(hashlib.sha256(zf.read(n)).hexdigest() for n in zf.namelist())
                names = zf.namelist()
            ok = got == sorted(hashlib.sha256(p.read_bytes()).hexdigest() for p in photos)
        check("photos download as one .zip, byte-for-byte", ok, ", ".join(names) if archive else "no file")

        form = q("[data-update]")
        js("const s = arguments[0]; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;"
           " set.call(s, 'shipped'); s.dispatchEvent(new Event('change', {bubbles: true}))", form.find_element(By.NAME, "status"))
        for name, value in {"courier": "Delhivery", "number": "DL123456", "url": "https://www.delhivery.com/track/package/DL123456"}.items():
            form.find_element(By.NAME, name).send_keys(value)
        click(form.find_element(By.CSS_SELECTOR, "button[type=submit]"))
        check("status + tracking saved", until(lambda: "Shipped" in q(".adm-history").text and q(".adm-sum .adm-status").text.lower() == "shipped"))
        stored = js("return fetch('/api/admin/order/?id=' + arguments[0]).then(r => r.json())", order_id)["order"]
        check(f"stored order ({health['storage']}): priced by the server, linked to the account",
              (stored["total"], stored["items"][0]["unit_price"], stored["status"], bool(stored["user_id"])) == (1198, 599, "shipped", True))
        check("customer link token works", token == stored["token"])
        click(q("[data-detail] [data-close]"))

        # ---------------------------------------------------------- admin switches a product off (and on again)
        # The keychain is the only product in Keychains, so the whole category must vanish from the shop too.
        set_viewport(d, 1440, 900, 1)
        d.get(base + "/admin/products/")
        row = lambda: d.find_element(By.XPATH, "//li[contains(@class,'adm-prod')][.//strong[text()='Photo Metal Keychain']]")  # noqa: E731
        warn = until(lambda: row().find_element(By.CSS_SELECTOR, ".adm-prod__warn").text, 15)
        check("products page warns it's the last keychain", bool(warn) and "Keychains" in warn, warn)
        click(row().find_element(By.CSS_SELECTOR, "[role=switch]"))
        toast = until(lambda: q(".toast").text, 10)
        check("hiding it says the category goes too", bool(toast) and "hidden" in toast and "Keychains" in toast, toast)
        shot("8b-admin-products")
        page = lambda path: js("return fetch(arguments[0], {cache: 'no-store'}).then(r => r.text())", path)  # noqa: E731 - like a fresh visit
        everywhere = ["/", "/shop/", "/collections/bestsellers/", "/gifts/for-couples/", "/about/", "/sitemap.xml", "/search.json"]
        leaks = [p for p in everywhere if any(s in page(p) for s in ("/collections/keychains/", "/products/photo-metal-keychain/"))]
        check("keychain and Keychains gone from home, listings, menus, footer, sitemap, search", not leaks, leaks)
        d.get(base + "/products/photo-metal-keychain/")
        check("its page says unavailable, with no add-to-cart",
              until(lambda: "Currently unavailable" in q(".pdp__unavailable").text) and not d.find_elements(By.CSS_SELECTOR, "[data-add]"))
        bad = js("return fetch('/api/quote/', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({items: [{slug: 'photo-metal-keychain'}]})}).then(r => r.status)")
        check("and it can't be priced or ordered", bad == 400)
        d.get(base + "/admin/products/")
        until(lambda: row())
        click(row().find_element(By.CSS_SELECTOR, "[role=switch]"))
        toast = until(lambda: q(".toast").text, 10)
        check("switching it on again says so", bool(toast) and "back on the website" in toast, toast)
        back = {p: "/collections/keychains/" in page(p) for p in ("/", "/shop/")}
        back["search"] = "/products/photo-metal-keychain/" in page("/search.json")
        check("…and brings it all back", all(back.values()), back)

        # ---------------------------------------------------------- guest tracks the order
        set_viewport(d, 390, 844, 2, True)
        d.delete_all_cookies()
        d.get(base + "/track-order/")
        wait_ready(d)
        q("[data-track-form] [name=id]").send_keys(order_id.lower())
        q("[data-track-form] [name=contact]").send_keys("+91 98765 43210")
        click(q("[data-track-form] button"))
        heading = until(lambda: "/order/" in d.current_url and q("[data-order-view] h1").text, 15)
        tracked = d.find_elements(By.CSS_SELECTOR, ".order-track a[href*='delhivery']")
        check("track-order finds it, with the tracking link", heading == "Shipped" and tracked, heading)
        shot("9-tracking")

        expected = ("/api/auth/login/", "/api/admin/orders/", "/api/orders/", "/api/quote/")  # deliberate: wrong password, customer 403, signed-out order 401, hidden-product quote 400
        errors = [e["message"] for e in d.get_log("browser") if e["level"] == "SEVERE" and not any(x in e["message"] for x in expected)]
        check("no unexpected console errors", not errors, "; ".join(errors)[:300])
    finally:
        d.quit()
        server.terminate()
    print(f"\n{'All steps passed' if not failures else f'{len(failures)} step(s) failed'}" + (f" - screenshots in {shots}" if args.shots else ""))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
