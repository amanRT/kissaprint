"""Order records: checkout validation, IDs, status flow and the views shown to customers and the team."""
from __future__ import annotations

import datetime as dt
import json
import re
import secrets
from functools import lru_cache

from .config import ROOT

# Order life cycle. "pending" = created at checkout, waiting for payment.
STATUSES = ("pending", "paid", "printing", "shipped", "delivered", "cancelled", "refunded")
CUSTOMER_LABELS = {"pending": "Awaiting payment", "paid": "Order confirmed", "printing": "Being printed",
                   "shipped": "Shipped", "delivered": "Delivered", "cancelled": "Cancelled", "refunded": "Refunded"}
PAID = ("paid", "printing", "shipped", "delivered")
ORDER_ID = re.compile(r"^KP-[2-9A-HJ-NP-Z]{6}$")
_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # no 0/O or 1/I - easy to read out on the phone
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PINCODE = re.compile(r"^[1-9][0-9]{5}$")


class FieldError(ValueError):
    """A checkout field that needs fixing; `field` names the input so the page can highlight it."""

    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


@lru_cache(maxsize=1)
def states() -> list:
    return json.loads((ROOT / "src" / "data" / "states.json").read_text(encoding="utf-8"))


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_order_id() -> str:
    return "KP-" + "".join(secrets.choice(_ID_ALPHABET) for _ in range(6))


def normalise_phone(raw) -> str:
    """Indian mobile number -> 10 digits. Accepts +91 / 91 / 0 prefixes, spaces and dashes."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits if re.fullmatch(r"[6-9]\d{9}", digits) else ""


def _text(data: dict, field: str, label: str, lo: int, hi: int, required: bool = True) -> str:
    value = re.sub(r"\s+", " ", str(data.get(field) or "")).strip()
    if not value and not required:
        return ""
    if len(value) < lo:
        raise FieldError(field, f"Please enter your {label}")
    if len(value) > hi:
        raise FieldError(field, f"Your {label} is too long (max {hi} characters)")
    return value


def clean_contact(customer) -> dict:
    if not isinstance(customer, dict):
        raise FieldError("name", "Please fill in your contact details")
    name = _text(customer, "name", "full name", 2, 80)
    phone = normalise_phone(customer.get("phone"))
    if not phone:
        raise FieldError("phone", "Please enter a valid 10-digit mobile number")
    email = str(customer.get("email") or "").strip().lower()
    if not EMAIL.match(email) or len(email) > 120:
        raise FieldError("email", "Please enter a valid email address")
    return {"name": name, "phone": phone, "email": email}


def clean_address(address) -> dict:
    if not isinstance(address, dict):
        raise FieldError("line1", "Please fill in your delivery address")
    clean = {
        "line1": _text(address, "line1", "flat / house number and building", 3, 120),
        "line2": _text(address, "line2", "area or street", 0, 120, required=False),
        "city": _text(address, "city", "city", 2, 60),
        "state": str(address.get("state") or "").strip(),
        "pincode": re.sub(r"\s", "", str(address.get("pincode") or "")),
    }
    if clean["state"] not in states():
        raise FieldError("state", "Please choose your state")
    if not PINCODE.match(clean["pincode"]):
        raise FieldError("pincode", "Please enter a valid 6-digit pincode")
    return clean


def new_order(quote: dict, customer: dict, address: dict, gateway: str) -> dict:
    stamp = now()
    return {
        "id": new_order_id(), "created_at": stamp, "updated_at": stamp, "status": "pending",
        "customer": customer, "address": address, "items": quote["lines"],
        "subtotal": quote["subtotal"], "shipping": quote["shipping"], "total": quote["total"], "currency": "INR",
        "gateway": gateway, "razorpay_order_id": None, "razorpay_payment_id": None, "payment": None,
        "tracking": None, "notes": "", "history": [{"at": stamp, "status": "pending", "note": "Order placed, awaiting payment"}],
        # Unguessable link token for the customer's order page (the order ID alone isn't enough).
        "token": secrets.token_urlsafe(18),
    }


def with_status(order: dict, status: str, note: str = "", **changes) -> dict:
    """Changes for a status update, with the history entry appended."""
    stamp = now()
    entry = {"at": stamp, "status": status}
    if note:
        entry["note"] = note
    return {**changes, "status": status, "updated_at": stamp, "history": [*(order.get("history") or []), entry]}


METHODS = {"upi": "UPI", "card": "card", "netbanking": "net banking", "wallet": "wallet", "emi": "EMI",
           "cardless_emi": "cardless EMI", "paylater": "pay later"}


def mark_paid_changes(order: dict, payment_id: str, payment: dict | None, via: str) -> dict:
    method = METHODS.get((payment or {}).get("method") or "", "")
    note = f"Payment received{' by ' + method if method else ''} ({via})"
    return with_status(order, "paid", note, razorpay_payment_id=payment_id, payment=payment or {"id": payment_id})


TEST_GATEWAYS = ("mock", "razorpay_test", "bypass")  # bypass = a team test number (TEST_PHONES), payment skipped


def is_test(order: dict) -> bool:
    """Placed with the local stand-in, Razorpay test keys or a team test number: no real money moved."""
    return order.get("gateway") in TEST_GATEWAYS


def same(a, b) -> bool:
    """Constant-time comparison that also copes with non-ASCII input."""
    return secrets.compare_digest(str(a or "").encode(), str(b or "").encode())


def contact_matches(order: dict, contact) -> bool:
    raw = str(contact or "").strip().lower()
    if not raw:
        return False
    if "@" in raw:
        return same(raw, order["customer"]["email"])
    phone = normalise_phone(raw)
    return bool(phone) and same(phone, order["customer"]["phone"])


def customer_view(order: dict) -> dict:
    """What the customer sees on their order page."""
    return {
        "id": order["id"], "status": order["status"], "status_label": CUSTOMER_LABELS[order["status"]],
        "created_at": order["created_at"], "name": order["customer"]["name"].split(" ")[0],
        "items": [{"name": ln["name"], "options": ln["options"], "note": ln["note"], "qty": ln["qty"],
                   "line_total": ln["line_total"], "photos": len(ln["photos"]), "photos_needed": ln["photos_needed"]}
                  for ln in order["items"]],
        "subtotal": order["subtotal"], "shipping": order["shipping"], "total": order["total"],
        "address": order["address"], "tracking": order.get("tracking"),
        "history": _steps(order.get("history") or []),
    }


def _steps(history: list) -> list:
    """Timeline for customers: one entry per status change (failed payment retries etc. collapse)."""
    steps = []
    for h in history:
        if not steps or steps[-1]["status"] != h["status"]:
            steps.append({"at": h["at"], "status": h["status"]})
    return steps


def admin_summary(order: dict) -> dict:
    items = order["items"]
    return {
        "id": order["id"], "created_at": order["created_at"], "status": order["status"],
        "name": order["customer"]["name"], "phone": order["customer"]["phone"],
        "city": order["address"]["city"], "state": order["address"]["state"], "total": order["total"],
        "items": [f"{ln['name']} ×{ln['qty']}" for ln in items],
        # Quantity 2 means two copies of the same design, so it needs the photos once.
        "photos": sum(len(ln["photos"]) for ln in items), "photos_needed": sum(ln["photos_needed"] for ln in items),
        "gateway": order.get("gateway", ""), "test": is_test(order),
    }
