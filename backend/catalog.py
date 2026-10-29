"""Server-side pricing from src/data/catalog.json. Prices sent by the browser are never trusted."""
from __future__ import annotations

import json
import re
from functools import lru_cache

from .config import ROOT

MAX_LINES = 20
MAX_QTY = 20
MAX_PHOTOS = 100
# Upload keys are issued by /api/uploads/ (see store.new_photo_key) - anything else is rejected.
PHOTO_KEY = re.compile(r"^up/\d{8}/[0-9a-f]{32}\.(?:jpg|png|webp|heic|heif)$")


class CartError(ValueError):
    """A cart the server can't price: unknown product or option, bad quantity, too many photos..."""


@lru_cache(maxsize=1)
def load() -> dict:
    return json.loads((ROOT / "src" / "data" / "catalog.json").read_text(encoding="utf-8"))


def site() -> dict:
    return load()["site"]


@lru_cache(maxsize=1)
def products() -> dict:
    return {p["slug"]: p for p in load()["products"]}


def default_index(product: dict, option: dict) -> int:
    """The pre-selected value of an option: the one matching the headline price, else the first.
    tools/build.py uses the same rule, so the product page and the server always agree."""
    for i, value in enumerate(option["values"]):
        if value.get("price") == product["price"]:
            return i
    return 0


def shipping_for(subtotal: int) -> int:
    s = site()
    return 0 if subtotal >= s["free_shipping_over"] else int(s["shipping_fee"])


def _photos(raw) -> list:
    if raw in (None, ""):
        return []
    if not isinstance(raw, list) or len(raw) > MAX_PHOTOS:
        raise CartError(f"Up to {MAX_PHOTOS} photos per item, please")
    clean = []
    for ph in raw:
        key = ph.get("key") if isinstance(ph, dict) else None
        if not isinstance(key, str) or not PHOTO_KEY.match(key):
            raise CartError("One of your photos didn't upload properly - please remove it and add it again")
        name = re.sub(r"[\x00-\x1f/\\]+", "", str(ph.get("name") or "photo"))[-120:] or "photo"
        try:
            size = max(0, int(ph.get("size") or 0))
        except (TypeError, ValueError):
            size = 0
        clean.append({"key": key, "name": name, "size": size})
    return clean


def price_line(line) -> dict:
    """Validate one cart line and price it from the catalog."""
    if not isinstance(line, dict):
        raise CartError("Something in your cart looks wrong - please remove it and add it again")
    p = products().get(str(line.get("slug", "")))
    if not p:
        raise CartError("A product in your cart is no longer available")
    chosen = line.get("opts") or {}
    if not isinstance(chosen, dict):
        raise CartError(f"{p['name']}: please choose your options again")
    unit, needed, options = p["price"], p.get("photos", 0), []
    for opt in p["options"]:
        label = chosen.get(opt["name"])
        if label is None:
            value = opt["values"][default_index(p, opt)]
        else:
            value = next((v for v in opt["values"] if v["label"] == label), None)
            if value is None:
                raise CartError(f"{p['name']}: “{label}” isn't available any more - please choose again")
        # Same rule as the product page: a priced value sets the unit price, a counted one the photos needed.
        unit = value.get("price", unit)
        needed = value.get("photos", needed)
        options.append([opt["name"], value["label"]])
    try:
        qty = int(line.get("qty", 1))
    except (TypeError, ValueError):
        raise CartError("Please check the quantities in your cart") from None
    if not 1 <= qty <= MAX_QTY:
        raise CartError(f"You can order 1 to {MAX_QTY} of each item")
    note = re.sub(r"\s+", " ", str(line.get("note") or "")).strip()[:60]
    return {"slug": p["slug"], "name": p["name"], "options": options, "note": note, "qty": qty,
            "unit_price": unit, "line_total": unit * qty, "photos": _photos(line.get("photos")), "photos_needed": needed}


def quote(lines) -> dict:
    """Price a whole cart: lines, subtotal, shipping and total (rupees, GST included)."""
    if not isinstance(lines, list) or not lines:
        raise CartError("Your cart is empty")
    if len(lines) > MAX_LINES:
        raise CartError(f"Please keep it to {MAX_LINES} items per order")
    priced = [price_line(line) for line in lines]
    subtotal = sum(line["line_total"] for line in priced)
    shipping = shipping_for(subtotal)
    return {"lines": priced, "subtotal": subtotal, "shipping": shipping, "total": subtotal + shipping}
