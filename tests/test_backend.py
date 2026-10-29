"""Backend tests - standard library only. Run: python -m unittest discover tests"""
import hashlib
import hmac
import json
import os
import sys
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import app, auth, catalog, orders  # noqa: E402
from backend.config import settings  # noqa: E402
from backend.payments import MockGateway, Razorpay  # noqa: E402
from backend.web import Request, route_of  # noqa: E402

CUSTOMER = {"name": "Aman Test", "phone": "+91 98765 43210", "email": "Aman@Example.com"}
ADDRESS = {"line1": "Flat 4B, Rose Apartments", "line2": "MG Road", "city": "Pune", "state": "Maharashtra", "pincode": "411001"}
PHOTO = {"key": "up/20261029/" + "a" * 32 + ".jpg", "name": "IMG_1.jpg", "size": 1234}


def call(method, route, body=None, cookie="", query="", headers=None, raw=None):
    msg = Message()
    if (body is not None or raw is not None) and "Content-Type" not in (headers or {}):
        msg["Content-Type"] = "application/json"
    if cookie:
        msg["Cookie"] = cookie
    for k, v in (headers or {}).items():
        msg[k] = v
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
    res = app.dispatch(Request(method, f"/api/{route}/" + (f"?{query}" if query else ""), msg, data))
    ctype = res.content_type
    return res.status, (json.loads(res.body) if "json" in ctype else res.body), res.headers


class Env(unittest.TestCase):
    """Each test gets a fresh local store and the mock gateway (no Razorpay/Supabase settings)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        clean = {k: v for k, v in os.environ.items() if not k.startswith(("RAZORPAY_", "SUPABASE_", "ADMIN_", "VERCEL"))}
        self.env = mock.patch.dict(os.environ, {**clean, "KP_DATA_DIR": self.tmp.name, "ADMIN_PASSWORD": "s3cret-pass"}, clear=True)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()


class Pricing(unittest.TestCase):
    def test_default_option_matches_headline_price(self):
        line = catalog.price_line({"slug": "classic-memoroids", "qty": 1})
        self.assertEqual((line["unit_price"], line["photos_needed"]), (249, 10))
        self.assertEqual(line["options"], [["Pack size", "10 prints"], ["Finish", "Matte"]])

    def test_newspaper_defaults_to_the_headline_price_not_the_first_value(self):
        self.assertEqual(catalog.price_line({"slug": "custom-newspaper"})["unit_price"], 549)

    def test_priced_option_and_quantity(self):
        line = catalog.price_line({"slug": "classic-memoroids", "qty": 2, "opts": {"Pack size": "30 prints", "Finish": "Glossy"}})
        self.assertEqual((line["unit_price"], line["line_total"], line["photos_needed"]), (599, 1198, 30))

    def test_client_prices_are_ignored(self):
        line = catalog.price_line({"slug": "song-plaque", "price": 1, "unit_price": 1, "qty": 1})
        self.assertEqual(line["unit_price"], 549)

    def test_bad_input(self):
        for bad in ({"slug": "nope"}, {"slug": "song-plaque", "qty": 0}, {"slug": "song-plaque", "qty": 21},
                    {"slug": "song-plaque", "qty": "x"}, {"slug": "song-plaque", "opts": {"Size": "Huge"}},
                    {"slug": "song-plaque", "photos": [{"key": "../../etc/passwd"}]}, "text"):
            with self.subTest(bad=bad), self.assertRaises(catalog.CartError):
                catalog.price_line(bad)

    def test_shipping_threshold(self):
        free_over, fee = catalog.site()["free_shipping_over"], catalog.site()["shipping_fee"]
        self.assertEqual(catalog.shipping_for(free_over - 1), fee)
        self.assertEqual(catalog.shipping_for(free_over), 0)
        q = catalog.quote([{"slug": "boarding-pass-card", "qty": 1}])
        self.assertEqual(q["total"], q["subtotal"] + fee)


class Validation(unittest.TestCase):
    def test_phone_formats(self):
        for raw in ("9876543210", "+91 98765 43210", "09876543210", "919876543210", "98765-43210"):
            self.assertEqual(orders.normalise_phone(raw), "9876543210", raw)
        for raw in ("12345", "5876543210", "", None, "98765432101"):
            self.assertEqual(orders.normalise_phone(raw), "", raw)

    def test_contact_and_address(self):
        self.assertEqual(orders.clean_contact(CUSTOMER), {"name": "Aman Test", "phone": "9876543210", "email": "aman@example.com"})
        self.assertEqual(orders.clean_address(ADDRESS)["pincode"], "411001")
        for field, value in (("email", "nope"), ("phone", "123"), ("name", "")):
            with self.subTest(field=field), self.assertRaises(orders.FieldError) as ctx:
                orders.clean_contact({**CUSTOMER, field: value})
            self.assertEqual(ctx.exception.field, field)
        for field, value in (("pincode", "011001"), ("state", "Atlantis"), ("city", "")):
            with self.subTest(field=field), self.assertRaises(orders.FieldError):
                orders.clean_address({**ADDRESS, field: value})

    def test_order_ids_are_readable(self):
        ids = {orders.new_order_id() for _ in range(200)}
        self.assertTrue(all(orders.ORDER_ID.match(i) for i in ids))
        self.assertGreater(len(ids), 195)


class Signatures(unittest.TestCase):
    def test_razorpay_payment_signature(self):
        rp = Razorpay("rzp_test_x", "secret123")
        sig = hmac.new(b"secret123", b"order_ABC|pay_XYZ", hashlib.sha256).hexdigest()
        self.assertTrue(rp.verify_payment("order_ABC", "pay_XYZ", sig))
        self.assertFalse(rp.verify_payment("order_ABC", "pay_OTHER", sig))
        self.assertFalse(rp.verify_payment("order_ABC", "pay_XYZ", None))

    def test_webhook_signature(self):
        body = b'{"event":"order.paid"}'
        rp = Razorpay("k", "s", "whsec")
        self.assertTrue(rp.verify_webhook(body, hmac.new(b"whsec", body, hashlib.sha256).hexdigest()))
        self.assertFalse(rp.verify_webhook(body + b" ", hmac.new(b"whsec", body, hashlib.sha256).hexdigest()))
        self.assertFalse(Razorpay("k", "s", "").verify_webhook(body, ""))


class Routing(unittest.TestCase):
    def test_route_names(self):
        self.assertEqual(route_of("/api/admin/orders/", {}), "admin/orders")
        self.assertEqual(route_of("/api/index", {"route": ["admin/orders"]}), "admin/orders")
        self.assertEqual(route_of("/api/index", {"route": ["admin", "orders"]}), "admin/orders")
        self.assertEqual(route_of("/api", {}), "")


class Admin(Env):
    def test_session_tokens(self):
        cfg = settings()
        token = auth.issue(cfg)
        self.assertTrue(auth.valid(cfg, token))
        self.assertFalse(auth.valid(cfg, token[:-1] + ("0" if token[-1] != "0" else "1")))
        self.assertFalse(auth.valid(cfg, "1." + token.split(".")[1]))  # expired
        with mock.patch.dict(os.environ, {"ADMIN_PASSWORD": "changed"}):
            self.assertFalse(auth.valid(settings(), token))

    def test_admin_needs_login(self):
        self.assertEqual(call("GET", "admin/orders")[0], 401)
        self.assertEqual(call("GET", "admin/me")[1], {"signed_in": False})
        with mock.patch("time.sleep"):
            self.assertEqual(call("POST", "admin/login", {"password": "wrong"})[0], 401)
        status, _, headers = call("POST", "admin/login", {"password": "s3cret-pass"})
        self.assertEqual(status, 200)
        cookie = dict(headers)["Set-Cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertEqual(call("GET", "admin/orders", cookie=cookie.split(";")[0])[0], 200)

    def test_json_only(self):
        status, data, _ = call("POST", "admin/login", raw=b"password=x", headers={"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(status, 415)


class OrderFlow(Env):
    def place(self, items=None):
        items = items or [{"slug": "classic-memoroids", "qty": 2, "opts": {"Pack size": "30 prints"}, "note": "us, always", "photos": [PHOTO]}]
        status, data, _ = call("POST", "orders", {"items": items, "customer": CUSTOMER, "address": ADDRESS})
        self.assertEqual(status, 201, data)
        return data

    def login(self):
        _, _, headers = call("POST", "admin/login", {"password": "s3cret-pass"})
        return dict(headers)["Set-Cookie"].split(";")[0]

    def test_quote(self):
        status, data, _ = call("POST", "quote", {"items": [{"slug": "song-plaque", "qty": 1}]})
        self.assertEqual(status, 200)
        self.assertEqual((data["subtotal"], data["shipping"], data["payments"]), (549, 79, "mock"))
        self.assertEqual(call("POST", "quote", {"items": []})[0], 400)

    def test_checkout_pay_and_fulfil(self):
        placed = self.place()
        order_id, pay = placed["order"]["id"], placed["payment"]
        self.assertEqual(placed["order"]["total"], 1198)  # 2 x 599, free shipping
        self.assertEqual(pay["amount"], 119800)
        self.assertEqual(pay["prefill"]["contact"], "+919876543210")

        # Bad signature is refused; the mock gateway's signed response is accepted, and again idempotently.
        bad = {**pay["mock"], "razorpay_signature": "0" * 64, "id": order_id}
        self.assertEqual(call("POST", "verify", bad)[0], 400)
        for _ in range(2):
            status, data, _ = call("POST", "verify", {**pay["mock"], "id": order_id})
            self.assertEqual((status, data["status"]), (200, "paid"))

        # Customer views: token link and track-order lookup by phone or email.
        token = placed["order"]["token"]
        self.assertEqual(call("GET", "order", query=f"id={order_id}&t=wrong")[0], 404)
        status, view, _ = call("GET", "order", query=f"id={order_id}&t={token}")
        self.assertEqual((status, view["status_label"], view["items"][0]["photos"]), (200, "Order confirmed", 1))
        self.assertNotIn("token", json.dumps(view))
        with mock.patch("time.sleep"):
            self.assertEqual(call("POST", "track", {"id": order_id, "contact": "9999999999"})[0], 404)
        self.assertEqual(call("POST", "track", {"id": order_id.lower(), "contact": "98765 43210"})[1]["token"], token)
        self.assertEqual(call("POST", "track", {"id": order_id, "contact": "AMAN@example.com"})[0], 200)

        # Admin sees it under "new", ships it with tracking, and the customer sees that.
        cookie = self.login()
        status, listing, _ = call("GET", "admin/orders", cookie=cookie, query="tab=new")
        self.assertEqual([o["id"] for o in listing["orders"]], [order_id])
        self.assertEqual((listing["counts"]["new"], listing["orders"][0]["photos_needed"]), (1, 30))
        status, detail, _ = call("GET", "admin/order", cookie=cookie, query=f"id={order_id}")
        self.assertIn(PHOTO["key"], detail["photos"])
        update = {"id": order_id, "status": "shipped", "note": "Packed with love",
                  "tracking": {"courier": "Delhivery", "number": "1234", "url": "https://www.delhivery.com/track/package/1234"}}
        status, data, _ = call("POST", "admin/order", update, cookie=cookie)
        self.assertEqual((status, data["order"]["status"]), (200, "shipped"))
        self.assertEqual(call("POST", "admin/order", {**update, "status": "pending"}, cookie=cookie)[0], 400)
        self.assertEqual(call("POST", "admin/order", {**update, "tracking": {"url": "javascript:alert(1)"}}, cookie=cookie)[0], 400)
        view = call("GET", "order", query=f"id={order_id}&t={token}")[1]
        self.assertEqual(view["tracking"]["courier"], "Delhivery")
        self.assertEqual([h["status"] for h in view["history"]], ["pending", "paid", "shipped"])

    def test_unpaid_orders_wait_in_their_own_tab(self):
        order_id = self.place()["order"]["id"]
        cookie = self.login()
        self.assertEqual(call("GET", "admin/orders", cookie=cookie, query="tab=new")[1]["orders"], [])
        self.assertEqual(call("GET", "admin/orders", cookie=cookie, query="tab=unpaid")[1]["orders"][0]["id"], order_id)
        self.assertEqual(call("GET", "admin/orders", cookie=cookie, query="tab=all&q=aman")[1]["counts"]["all"], 1)

    def test_dashboard_change_check(self):
        cookie = self.login()
        self.assertEqual(call("GET", "admin/changes")[0], 401)
        before = call("GET", "admin/changes", cookie=cookie)[1]["latest"]
        placed = self.place()
        after = call("GET", "admin/changes", cookie=cookie)[1]["latest"]
        self.assertNotEqual(before, after)
        self.assertEqual(call("GET", "admin/orders", cookie=cookie, query="tab=all")[1]["latest"], after)
        with mock.patch("backend.orders.now", return_value="2999-01-01T00:00:00Z"):  # a status change also counts
            call("POST", "admin/order", {"id": placed["order"]["id"], "note": "checked photos"}, cookie=cookie)
        self.assertEqual(call("GET", "admin/changes", cookie=cookie)[1]["latest"], "2999-01-01T00:00:00Z")

    def test_only_test_orders_can_be_deleted(self):
        placed = self.place()
        order_id = placed["order"]["id"]
        cookie = self.login()
        self.assertTrue(call("GET", "admin/orders", cookie=cookie, query="tab=all")[1]["orders"][0]["test"])
        self.assertEqual(call("POST", "admin/delete", {"id": order_id})[0], 401)  # needs sign-in
        store = app.make_store(settings())
        store.update_order(order_id, {"gateway": "razorpay"})  # pretend it was a live payment
        self.assertEqual(call("POST", "admin/delete", {"id": order_id}, cookie=cookie)[0], 400)
        store.update_order(order_id, {"gateway": "mock"})
        self.assertEqual(call("POST", "admin/delete", {"id": order_id}, cookie=cookie)[0], 200)
        self.assertIsNone(store.get_order(order_id))

    def test_validation_errors_name_the_field(self):
        status, data, _ = call("POST", "orders", {"items": [{"slug": "song-plaque"}], "customer": {**CUSTOMER, "phone": "12"}, "address": ADDRESS})
        self.assertEqual((status, data["field"]), (400, "phone"))

    def test_uploads_local(self):
        status, data, _ = call("POST", "uploads", {"slug": "classic-memoroids", "files": [{"name": "a.jpg", "type": "image/jpeg", "size": 10}]})
        self.assertEqual(status, 200)
        target = data["uploads"][0]
        self.assertTrue(catalog.PHOTO_KEY.match(target["key"]))
        query = target["url"].split("?", 1)[1]
        self.assertEqual(call("PUT", "upload-local", query=query.replace("sig=", "sig=0"), raw=b"x")[0], 403)
        self.assertEqual(call("PUT", "upload-local", query=query, raw=b"jpegbytes")[0], 200)
        self.assertEqual(call("POST", "uploads", {"slug": "classic-memoroids", "files": [{"name": "a.exe", "type": "application/x-msdownload"}]})[0], 400)
        self.assertEqual(call("POST", "uploads", {"slug": "classic-memoroids", "files": [{"name": "big.jpg", "type": "image/jpeg", "size": 30 * 2**20}]})[0], 400)


class TestPhones(Env):
    """Team test numbers (TEST_PHONES) order without paying - and those orders are always flagged as tests."""
    BODY = {"items": [{"slug": "song-plaque"}], "address": ADDRESS}

    def test_team_numbers_skip_payment_but_are_flagged(self):
        os.environ["TEST_PHONES"] = "9000000001, +91 90000 00002, junk"
        self.assertEqual(settings().test_phones, ("9000000001", "9000000002"))
        status, data, _ = call("POST", "orders", {**self.BODY, "customer": {**CUSTOMER, "phone": "090000 00002"}})
        self.assertEqual((status, data["payment"]), (201, {"gateway": "bypass"}))
        order = app.make_store(settings()).get_order(data["order"]["id"])
        self.assertEqual((order["status"], order["gateway"], orders.is_test(order)), ("paid", "bypass", True))
        status, data, _ = call("POST", "orders", {**self.BODY, "customer": CUSTOMER})  # everyone else still pays
        self.assertEqual((status, data["payment"]["gateway"]), (201, "mock"))

    def test_bypass_works_before_payments_are_set_up(self):
        from backend.store import LocalStore
        os.environ.update({"VERCEL": "1", "TEST_PHONES": "9000000001"})
        with mock.patch("backend.app.make_store", return_value=LocalStore(Path(self.tmp.name))):
            self.assertEqual(call("POST", "orders", {**self.BODY, "customer": {**CUSTOMER, "phone": "9000000001"}})[0], 201)
            self.assertEqual(call("POST", "orders", {**self.BODY, "customer": CUSTOMER})[0], 503)  # no Razorpay keys yet


class Webhook(Env):
    def setUp(self):
        super().setUp()
        os.environ.update({"RAZORPAY_KEY_ID": "rzp_test_abc", "RAZORPAY_KEY_SECRET": "keysecret", "RAZORPAY_WEBHOOK_SECRET": "whsec"})

    def test_webhook_marks_paid_once(self):
        with mock.patch.object(Razorpay, "create_order", return_value={"id": "order_RZP1", "amount": 54900 + 7900}):
            status, placed, _ = call("POST", "orders", {"items": [{"slug": "song-plaque"}], "customer": CUSTOMER, "address": ADDRESS})
        self.assertEqual(status, 201, placed)
        self.assertNotIn("mock", placed["payment"])
        self.assertTrue(placed["test_mode"])
        order_id = placed["order"]["id"]
        self.assertEqual(app.make_store(settings()).get_order(order_id)["gateway"], "razorpay_test")  # flagged as a test order

        def send(event, amount=62800):
            body = json.dumps({"event": event, "payload": {"payment": {"entity": {
                "id": "pay_RZP1", "order_id": "order_RZP1", "amount": amount, "currency": "INR", "method": "upi",
                "error_description": "Bank declined"}}}}).encode()
            sig = hmac.new(b"whsec", body, hashlib.sha256).hexdigest()
            return call("POST", "razorpay-webhook", raw=body, headers={"X-Razorpay-Signature": sig})

        self.assertEqual(call("POST", "razorpay-webhook", raw=b"{}", headers={"X-Razorpay-Signature": "bad"})[0], 400)
        send("payment.failed")
        send("order.paid", amount=100)  # wrong amount: logged, not paid
        cookie = self._login()
        detail = call("GET", "admin/order", cookie=cookie, query=f"id={order_id}")[1]["order"]
        self.assertEqual(detail["status"], "pending")
        self.assertEqual(send("payment.captured")[0], 200)
        self.assertEqual(send("order.paid")[0], 200)  # duplicate delivery is harmless
        detail = call("GET", "admin/order", cookie=cookie, query=f"id={order_id}")[1]["order"]
        self.assertEqual((detail["status"], detail["razorpay_payment_id"]), ("paid", "pay_RZP1"))
        self.assertEqual(sum(h["status"] == "paid" for h in detail["history"]), 1)

    def _login(self):
        _, _, headers = call("POST", "admin/login", {"password": "s3cret-pass"})
        return dict(headers)["Set-Cookie"].split(";")[0]


class SupabaseRequests(unittest.TestCase):
    """The exact REST / Storage calls SupabaseStore makes (no network: urlopen is faked)."""

    def setUp(self):
        from backend.store import SupabaseStore
        self.calls = []
        self.replies = []

        class Reply:
            def __init__(self, status, data):
                self.status, self._data = status, json.dumps(data).encode()

            def read(self):
                return self._data

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def fake_urlopen(req, timeout=None):
            body = json.loads(req.data) if req.data else None
            self.calls.append((req.get_method(), req.full_url, dict(req.header_items()), body))
            return Reply(*self.replies.pop(0))

        patcher = mock.patch("backend.store.urllib.request.urlopen", fake_urlopen)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.store = SupabaseStore("https://abc.supabase.co", "sb_secret_xyz", "order-photos")

    def test_orders(self):
        self.replies = [(201, [{"id": "KP-ABCDEF"}]), (200, [{"id": "KP-ABCDEF", "status": "paid"}]), (200, [])]
        self.store.create_order({"id": "KP-ABCDEF"})
        method, url, headers, body = self.calls[0]
        self.assertEqual((method, url), ("POST", "https://abc.supabase.co/rest/v1/orders"))
        self.assertEqual(headers["Apikey"], "sb_secret_xyz")
        self.assertNotIn("Authorization", headers)  # new-style secret keys go in apikey only
        self.assertEqual(headers["Prefer"], "return=representation")
        self.assertEqual(self.store.update_order("KP-ABCDEF", {"status": "paid"}, expect=("pending",))["status"], "paid")
        self.assertEqual(self.calls[1][1], "https://abc.supabase.co/rest/v1/orders?id=eq.KP-ABCDEF&status=in.(pending)")
        self.store.list_orders(("paid",), q="riya, (x)", oldest_first=True)
        url = self.calls[2][1]
        self.assertIn("order=created_at.asc", url)
        self.assertIn("status=in.(paid)", url)
        self.assertIn("or=%28id.ilike.%2Ariya%20x%2A%2Ccustomer-%3E%3Ename.ilike", url)  # commas/brackets stripped from q

    def test_legacy_service_role_key_also_sent_as_bearer(self):
        from backend.store import SupabaseStore
        self.replies = [(200, [])]
        SupabaseStore("https://abc.supabase.co", "eyJhbGciOi.legacy", "order-photos").get_order("KP-ABCDEF")
        self.assertEqual(self.calls[0][2]["Authorization"], "Bearer eyJhbGciOi.legacy")

    def test_conflict_and_errors(self):
        from backend.store import Conflict, StoreError
        self.replies = [(409, {"message": "duplicate key"})]
        with mock.patch("backend.store.urllib.request.urlopen", side_effect=self._http_error(409)):
            with self.assertRaises(Conflict):
                self.store.create_order({"id": "KP-ABCDEF"})
        with mock.patch("backend.store.urllib.request.urlopen", side_effect=self._http_error(500)):
            with self.assertRaises(StoreError):
                self.store.get_order("KP-ABCDEF")
        self.assertIsNone(self.store.get_order("../etc"))  # never even sent

    @staticmethod
    def _http_error(code):
        import io
        import urllib.error
        return urllib.error.HTTPError("https://abc.supabase.co", code, "err", {}, io.BytesIO(b'{"message":"boom"}'))

    def test_storage(self):
        key = "up/20261029/" + "b" * 32 + ".jpg"
        self.replies = [(200, {"url": f"/object/upload/sign/order-photos/{key}?token=T1"}),
                        (200, [{"path": key, "signedURL": f"/object/sign/order-photos/{key}?token=T2"}])]
        target = self.store.upload_targets([(key, "image/jpeg")])[0]
        self.assertEqual(self.calls[0][:2], ("POST", f"https://abc.supabase.co/storage/v1/object/upload/sign/order-photos/{key}"))
        self.assertEqual(target["url"], f"https://abc.supabase.co/storage/v1/object/upload/sign/order-photos/{key}?token=T1")
        self.assertEqual((target["method"], target["headers"]["Content-Type"]), ("PUT", "image/jpeg"))
        urls = self.store.photo_urls([key])
        self.assertEqual(self.calls[1][3], {"expiresIn": 3600, "paths": [key]})
        self.assertEqual(urls[key], f"https://abc.supabase.co/storage/v1/object/sign/order-photos/{key}?token=T2")


class Production(unittest.TestCase):
    def test_vercel_without_settings_refuses_instead_of_faking(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("RAZORPAY_", "SUPABASE_", "ADMIN_"))}
        with mock.patch.dict(os.environ, {**env, "VERCEL": "1"}, clear=True):
            cfg = settings()
            self.assertEqual((cfg.payments, cfg.storage, cfg.admin_password), ("", "", ""))
            status, data, _ = call("POST", "orders", {"items": [{"slug": "song-plaque"}], "customer": CUSTOMER, "address": ADDRESS})
            self.assertEqual(status, 503)
            self.assertEqual(call("POST", "admin/login", {"password": "admin"})[0], 503)

    def test_setup_mistakes_are_reported(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("RAZORPAY_", "SUPABASE_", "ADMIN_"))}
        wrong = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SECRET_KEY": "sb_publishable_abc",
                 "RAZORPAY_KEY_ID": "rzp_test_k", "RAZORPAY_KEY_SECRET": "s", "VERCEL": "1", "ADMIN_PASSWORD": "short"}
        with mock.patch.dict(os.environ, {**env, **wrong}, clear=True):
            cfg = settings()
            self.assertEqual(cfg.storage, "")  # a publishable key can't run the shop, so storage stays off
            text = " ".join(cfg.problems)
            for hint in ("publishable key", "RAZORPAY_WEBHOOK_SECRET", "ADMIN_PASSWORD is short"):
                self.assertIn(hint, text)
            self.assertEqual(call("GET", "health")[1]["problems"], cfg.problems)
        good = {**wrong, "SUPABASE_SECRET_KEY": "sb_secret_abc", "RAZORPAY_WEBHOOK_SECRET": "w", "ADMIN_PASSWORD": "a-long-enough-pass"}
        with mock.patch.dict(os.environ, {**env, **good}, clear=True):
            self.assertEqual((settings().problems, settings().storage), ([], "supabase"))
        for pasted in ("https://x.supabase.co/rest/v1/", "https://x.supabase.co/rest/v1", "https://x.supabase.co/"):
            with mock.patch.dict(os.environ, {**env, **good, "SUPABASE_URL": pasted}, clear=True):
                self.assertEqual(settings().supabase_url, "https://x.supabase.co", pasted)

    def test_mock_gateway_never_used_with_real_keys(self):
        with mock.patch.dict(os.environ, {"RAZORPAY_KEY_ID": "rzp_live_x", "RAZORPAY_KEY_SECRET": "y"}):
            cfg = settings()
            self.assertEqual(cfg.payments, "razorpay")
            self.assertFalse(cfg.test_mode)
        self.assertIsInstance(MockGateway(), Razorpay)


if __name__ == "__main__":
    unittest.main()
