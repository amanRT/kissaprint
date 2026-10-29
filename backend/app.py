"""API routes (all under /api/, always called with a trailing slash to match vercel.json's trailingSlash).

Shop:   GET health · POST quote · POST uploads · PUT upload-local (dev) · POST orders · POST verify
        POST razorpay-webhook · GET order · POST track
Admin:  POST admin/login · POST admin/logout · GET admin/me · GET admin/orders · GET/POST admin/order
        GET admin/photo (dev)
"""
from __future__ import annotations

import json
import sys
import time
import traceback

from . import auth, catalog, orders
from .config import settings
from .payments import PaymentError, gateway
from .store import MAX_PHOTO_MB, Conflict, LocalStore, StoreError, make_store, new_photo_key
from .web import ApiError, Request, Response

ROUTES: dict = {}
# Admin list tabs -> statuses
TABS = {"new": ("paid",), "printing": ("printing",), "shipped": ("shipped",), "delivered": ("delivered",),
        "unpaid": ("pending",), "closed": ("cancelled", "refunded"), "all": None}
PHOTO_MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "heic": "image/heic", "heif": "image/heif"}


def log(*parts) -> None:
    print("[kissaprints]", *parts, file=sys.stderr, flush=True)


class Ctx:
    """Per-request access to settings, the order store and the payment gateway."""

    def __init__(self):
        self.cfg = settings()
        self._store = self._gateway = None

    @property
    def store(self):
        if self._store is None:
            self._store = make_store(self.cfg)
            if self._store is None:
                raise ApiError(503, "Orders aren't switched on yet - the shop owner needs to connect Supabase")
        return self._store

    @property
    def gateway(self):
        if self._gateway is None:
            self._gateway = gateway(self.cfg)
            if self._gateway is None:
                raise ApiError(503, "Online payments aren't switched on yet - the shop owner needs to add Razorpay keys")
        return self._gateway

    @property
    def gateway_label(self) -> str:
        """Stored on each order: 'razorpay' (live keys), 'razorpay_test' or 'mock'. The last two are test orders."""
        name = self.gateway.name
        return name if name != "razorpay" else ("razorpay_test" if self.cfg.test_mode else "razorpay")


def route(method: str, name: str):
    def register(fn):
        ROUTES[(method, name)] = fn
        return fn
    return register


def dispatch(req: Request) -> Response:
    fn = ROUTES.get(("GET" if req.method == "HEAD" else req.method, req.route))
    if fn is None:
        known = any(name == req.route for _, name in ROUTES)
        return Response.json({"error": "Method not allowed" if known else "Not found"}, 405 if known else 404)
    try:
        return fn(req, Ctx())
    except ApiError as exc:
        return Response.json({"error": str(exc), **({"field": exc.field} if exc.field else {})}, exc.status)
    except orders.FieldError as exc:
        return Response.json({"error": str(exc), "field": exc.field}, 400)
    except catalog.CartError as exc:
        return Response.json({"error": str(exc)}, 400)
    except PaymentError as exc:
        log("payment gateway:", exc)
        return Response.json({"error": str(exc)}, 502)
    except StoreError as exc:
        log("store:", exc)
        return Response.json({"error": "Our order system is having a moment - please try again in a minute"}, 503)
    except Exception:  # noqa: BLE001 - never leak a traceback to the browser
        traceback.print_exc()
        return Response.json({"error": "Something went wrong on our side - please try again"}, 500)


def require_admin(req: Request, ctx: Ctx) -> None:
    if not auth.valid(ctx.cfg, req.cookie(auth.COOKIE)):
        raise ApiError(401, "Please sign in")


def slim_payment(payment: dict | None, payment_id: str) -> dict:
    if not payment:
        return {"id": payment_id}
    keep = {k: payment[k] for k in ("id", "method", "status", "amount", "vpa", "bank", "wallet", "created_at")
            if payment.get(k) is not None}
    card = payment.get("card") or {}
    if card:
        keep["card"] = {k: card[k] for k in ("network", "last4", "type") if card.get(k)}
    return keep


# ---------------------------------------------------------------- shop
@route("GET", "health")
def health(req, ctx):
    cfg = ctx.cfg
    return Response.json({"ok": True, "payments": cfg.payments or "off", "storage": cfg.storage or "off",
                          "test_mode": cfg.test_mode, "webhook": bool(cfg.razorpay_webhook_secret),
                          "admin": bool(cfg.admin_password), "problems": cfg.problems})


@route("POST", "quote")
def quote(req, ctx):
    q = catalog.quote(req.json().get("items"))
    lines = [{**{k: ln[k] for k in ("slug", "name", "options", "note", "qty", "unit_price", "line_total", "photos_needed")},
              "photos": len(ln["photos"])} for ln in q["lines"]]
    return Response.json({"lines": lines, "subtotal": q["subtotal"], "shipping": q["shipping"], "total": q["total"],
                          "free_shipping_over": catalog.site()["free_shipping_over"],
                          "payments": ctx.cfg.payments or "off", "test_mode": ctx.cfg.test_mode})


@route("POST", "uploads")
def uploads(req, ctx):
    """One-time upload URLs for up to 20 photos; the browser PUTs each file straight to storage."""
    data = req.json()
    files = data.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= 20:
        raise ApiError(400, "Send between 1 and 20 photos at a time")
    if str(data.get("slug", "")) not in catalog.products():
        raise ApiError(400, "Unknown product")
    items = []
    for f in files:
        f = f if isinstance(f, dict) else {}
        try:
            size = int(f.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        if size > MAX_PHOTO_MB * 1024 * 1024:
            raise ApiError(400, f"Photos can be up to {MAX_PHOTO_MB} MB each")
        try:
            items.append(new_photo_key(str(f.get("name") or ""), str(f.get("type") or "")))
        except ValueError as exc:
            raise ApiError(400, str(exc)) from None
    return Response.json({"uploads": ctx.store.upload_targets(items)})


@route("PUT", "upload-local")
def upload_local(req, ctx):
    store = ctx.store
    if not isinstance(store, LocalStore):
        raise ApiError(404, "Not found")
    key = req.query.get("key", "")
    if not store.valid_upload(key, req.query.get("sig", "")):
        raise ApiError(403, "This upload link isn't valid")
    if not req.body:
        raise ApiError(400, "Empty file")
    store.save_upload(key, req.body)
    return Response.json({"ok": True, "key": key})


@route("POST", "orders")
def create_order(req, ctx):
    """Checkout: re-price the cart, validate contact + address, open a Razorpay order, save ours as pending."""
    data = req.json()
    q = catalog.quote(data.get("items"))
    customer = orders.clean_contact(data.get("customer"))
    address = orders.clean_address(data.get("address"))
    store = ctx.store
    # Team test numbers (TEST_PHONES) skip payment. The order is saved as paid but labelled "Test" everywhere.
    if customer["phone"] in ctx.cfg.test_phones:
        def bypass(order):
            order.update(orders.with_status(order, "paid", "Team test number - payment skipped, test order",
                                            payment={"method": "test", "skipped": True}))
        order = _save_new(store, q, customer, address, "bypass", bypass)
        return Response.json({"order": {"id": order["id"], "token": order["token"], "total": order["total"]},
                              "payment": {"gateway": "bypass"}, "test_mode": True}, 201)
    gw = ctx.gateway
    rzp = {}

    def open_payment(order):
        rzp.update(gw.create_order(order["total"] * 100, order["id"], {"kp_order": order["id"], "customer": customer["name"][:60]}))
        order["razorpay_order_id"] = rzp["id"]
    order = _save_new(store, q, customer, address, ctx.gateway_label, open_payment)
    return Response.json({"order": {"id": order["id"], "token": order["token"], "total": order["total"]},
                          "payment": gw.checkout_options(order, rzp, req.origin + "/icon-192.png"),
                          "test_mode": ctx.cfg.test_mode}, 201)


def _save_new(store, q, customer, address, gateway_label, prepare):
    for _ in range(3):  # retry only on an order-ID collision (1 in ~900 million)
        order = orders.new_order(q, customer, address, gateway_label)
        prepare(order)
        try:
            return store.create_order(order)
        except Conflict:
            continue
    raise ApiError(500, "Couldn't create your order - please try again")


@route("POST", "verify")
def verify(req, ctx):
    """The browser's success callback from Razorpay Checkout. The webhook confirms independently."""
    data = req.json()
    store = ctx.store
    order = store.get_order(str(data.get("id", "")))
    if not order:
        raise ApiError(404, "Order not found")
    if order["status"] in orders.PAID:
        return Response.json({"ok": True, "id": order["id"], "status": order["status"]})
    if order["status"] != "pending":
        raise ApiError(409, "This order was cancelled - please contact us")
    gw = ctx.gateway
    if order.get("gateway") != ctx.gateway_label:  # e.g. placed with test keys, now live (or the other way round)
        raise ApiError(409, "This order was started with a different payment setup - please place it again")
    pay_id = str(data.get("razorpay_payment_id") or "")
    if not pay_id or not gw.verify_payment(order["razorpay_order_id"], pay_id, data.get("razorpay_signature")):
        raise ApiError(400, "We couldn't confirm this payment. If money left your account, contact us with your "
                            f"order number {order['id']} and we'll sort it out.")
    try:
        payment = gw.fetch_payment(pay_id)  # method/UPI ID for the team; the signature alone already proves payment
    except PaymentError:
        payment = None
    updated = store.update_order(order["id"], orders.mark_paid_changes(order, pay_id, slim_payment(payment, pay_id), "checkout"),
                                 expect=("pending",))
    final = updated or store.get_order(order["id"])  # None = the webhook got there first
    return Response.json({"ok": True, "id": final["id"], "status": final["status"]})


@route("POST", "razorpay-webhook")
def webhook(req, ctx):
    """Razorpay -> us. Marks orders paid even if the customer closed the tab before the redirect."""
    gw = ctx.gateway
    if gw.name != "razorpay":
        raise ApiError(404, "Not found")
    if not ctx.cfg.razorpay_webhook_secret:
        raise ApiError(503, "RAZORPAY_WEBHOOK_SECRET isn't set")
    if not gw.verify_webhook(req.body, req.headers.get("X-Razorpay-Signature") or ""):
        raise ApiError(400, "Invalid signature")
    event = json.loads(req.body)  # only parsed after the signature check on the raw bytes
    kind = event.get("event", "")
    pay = ((event.get("payload") or {}).get("payment") or {}).get("entity") or {}
    if kind not in ("payment.captured", "order.paid", "payment.failed") or not pay.get("order_id"):
        return Response.json({"ok": True, "ignored": kind})
    store = ctx.store
    order = store.find_by_razorpay_order(pay["order_id"])
    if not order:
        return Response.json({"ok": True, "ignored": "unknown order"})
    if kind == "payment.failed":
        if order["status"] == "pending":
            reason = str(pay.get("error_description") or "no reason given")[:140]
            store.update_order(order["id"], orders.with_status(order, "pending", f"Payment attempt failed: {reason}"), expect=("pending",))
        return Response.json({"ok": True})
    if pay.get("amount") != order["total"] * 100 or (pay.get("currency") or "INR") != "INR":
        log(f"amount mismatch on {order['id']}: paid {pay.get('amount')} {pay.get('currency')}, expected {order['total'] * 100}")
        store.update_order(order["id"], orders.with_status(order, order["status"], "Razorpay amount doesn't match the order - check the dashboard"))
        return Response.json({"ok": True, "ignored": "amount mismatch"})
    if order["status"] == "pending":
        store.update_order(order["id"], orders.mark_paid_changes(order, pay["id"], slim_payment(pay, pay["id"]), "webhook"),
                           expect=("pending",))
    return Response.json({"ok": True})


@route("GET", "order")
def order_view(req, ctx):
    order = ctx.store.get_order(req.query.get("id", ""))
    if not order or not orders.same(order.get("token"), req.query.get("t", "")):
        raise ApiError(404, "We couldn't find that order")
    return Response.json(orders.customer_view(order))


@route("POST", "track")
def track(req, ctx):
    data = req.json()
    order_id = str(data.get("id") or "").strip().upper().replace(" ", "")
    if order_id and not order_id.startswith("KP-"):
        order_id = "KP-" + order_id.removeprefix("KP")
    order = ctx.store.get_order(order_id)
    if not order or not orders.contact_matches(order, data.get("contact")):
        time.sleep(0.6)  # slows down guessing
        raise ApiError(404, "We couldn't find an order with those details. Check the order number (like KP-7XK2QD) "
                            "and use the email or mobile number you checked out with.")
    return Response.json({"id": order["id"], "token": order["token"]})


# ---------------------------------------------------------------- admin
@route("POST", "admin/login")
def admin_login(req, ctx):
    if not ctx.cfg.admin_password:
        raise ApiError(503, "Set ADMIN_PASSWORD in the Vercel project settings first")
    if not auth.check_password(ctx.cfg, req.json().get("password")):
        time.sleep(1)  # slows down password guessing
        raise ApiError(401, "That password isn't right")
    return Response.json({"ok": True}, headers=[("Set-Cookie", auth.cookie(auth.issue(ctx.cfg), req.secure))])


@route("POST", "admin/logout")
def admin_logout(req, ctx):
    return Response.json({"ok": True}, headers=[("Set-Cookie", auth.cookie("", req.secure, max_age=0))])


@route("GET", "admin/me")
def admin_me(req, ctx):
    """Session check on page load; answers 200 either way so a signed-out visit logs no console error."""
    cfg = ctx.cfg
    if not auth.valid(cfg, req.cookie(auth.COOKIE)):
        return Response.json({"signed_in": False})
    return Response.json({"signed_in": True, "payments": cfg.payments or "off", "storage": cfg.storage or "off",
                          "test_mode": cfg.test_mode, "webhook": bool(cfg.razorpay_webhook_secret), "problems": cfg.problems})


@route("GET", "admin/orders")
def admin_orders(req, ctx):
    require_admin(req, ctx)
    tab = req.query.get("tab") or "new"
    if tab not in TABS:
        raise ApiError(400, "Unknown tab")
    store = ctx.store
    # The work queues (to print, printing) run oldest first so nobody waits longest; the rest newest first.
    rows = store.list_orders(TABS[tab], req.query.get("q", "").strip(), oldest_first=tab in ("new", "printing"))
    counts = store.status_counts()
    return Response.json({"orders": [orders.admin_summary(o) for o in rows], "latest": store.latest_change(),
                          "counts": {t: sum(counts.get(s, 0) for s in (sts or orders.STATUSES)) for t, sts in TABS.items()}})


@route("GET", "admin/changes")
def admin_changes(req, ctx):
    """The dashboard polls this every 30 s and reloads its list only when the answer changes."""
    require_admin(req, ctx)
    return Response.json({"latest": ctx.store.latest_change()})


@route("GET", "admin/order")
def admin_order(req, ctx):
    require_admin(req, ctx)
    order = ctx.store.get_order(req.query.get("id", ""))
    if not order:
        raise ApiError(404, "Order not found")
    keys = [ph["key"] for line in order["items"] for ph in line["photos"]]
    return Response.json({"order": order, "photos": ctx.store.photo_urls(keys)})


@route("POST", "admin/order")
def admin_update(req, ctx):
    """Status, courier tracking and internal notes. Refunds themselves happen in the Razorpay dashboard."""
    require_admin(req, ctx)
    data = req.json()
    store = ctx.store
    order = store.get_order(str(data.get("id") or ""))
    if not order:
        raise ApiError(404, "Order not found")
    status = data.get("status") or order["status"]
    if status not in orders.STATUSES or (status == "pending" and order["status"] != "pending"):
        raise ApiError(400, "Please pick a valid status", "status")
    changes = {}
    if "notes" in data:
        changes["notes"] = str(data.get("notes") or "")[:4000]
    if "tracking" in data:
        t = data.get("tracking") if isinstance(data.get("tracking"), dict) else {}
        tracking = {"courier": str(t.get("courier") or "").strip()[:60], "number": str(t.get("number") or "").strip()[:80],
                    "url": str(t.get("url") or "").strip()[:500]}
        if tracking["url"] and not tracking["url"].startswith(("https://", "http://")):
            raise ApiError(400, "The tracking link should start with https://", "url")
        changes["tracking"] = tracking if any(tracking.values()) else None
    note = str(data.get("note") or "").strip()[:280]
    if status != order["status"] or note:
        changes = orders.with_status(order, status, note, **changes)
    else:
        changes["updated_at"] = orders.now()
    return Response.json({"order": store.update_order(order["id"], changes)})


@route("POST", "admin/delete")
def admin_delete(req, ctx):
    """Remove a test order and its photos. Real (live-payment) orders can never be deleted from here."""
    require_admin(req, ctx)
    store = ctx.store
    order = store.get_order(str(req.json().get("id") or ""))
    if not order:
        raise ApiError(404, "Order not found")
    if not orders.is_test(order):
        raise ApiError(400, "Only test orders can be deleted. Cancel or refund real orders instead.")
    store.delete_photos([ph["key"] for line in order["items"] for ph in line["photos"]])
    store.delete_order(order["id"])
    return Response.json({"ok": True, "id": order["id"]})


@route("GET", "admin/photo")
def admin_photo(req, ctx):
    """Local development only - in production the dashboard gets signed Supabase URLs instead."""
    require_admin(req, ctx)
    store = ctx.store
    if not isinstance(store, LocalStore):
        raise ApiError(404, "Not found")
    key = req.query.get("key", "")
    data = store.read_photo(key)
    if data is None:
        raise ApiError(404, "Photo not found")
    return Response(200, data, PHOTO_MIME[key.rsplit(".", 1)[-1]])
