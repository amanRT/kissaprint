"""Where orders and customer photos live.

- SupabaseStore (production): orders in a Postgres table via the REST API, photos in a private
  Storage bucket. Browsers upload photos straight to Storage with one-time signed URLs, so big
  files never pass through the Vercel Function (which caps request bodies at 4.5 MB).
- LocalStore (development): JSON files and photos under .data/.
Table and bucket setup: backend/schema.sql.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import re
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .catalog import PHOTO_KEY
from .orders import ORDER_ID

MAX_PHOTO_MB = 25
PHOTO_TYPES = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
               "image/heic": "heic", "image/heif": "heif"}


class StoreError(RuntimeError):
    """The order database or photo storage failed."""


class Conflict(StoreError):
    """An order with this ID already exists."""


def new_photo_key(filename: str, content_type: str) -> tuple[str, str]:
    """-> (storage key, content type). Raises ValueError for files that aren't supported photos."""
    ctype = (content_type or "").lower()
    ext = PHOTO_TYPES.get(ctype)
    if not ext:  # some phones send HEIC with an empty type
        suffix = Path(filename or "").suffix.lower().lstrip(".")
        ext = {"jpeg": "jpg"}.get(suffix, suffix)
        if ext not in PHOTO_TYPES.values():
            raise ValueError("Please add JPG, PNG, WebP or HEIC photos")
        ctype = next(t for t, e in PHOTO_TYPES.items() if e == ext)
    day = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")
    return f"up/{day}/{uuid.uuid4().hex}.{ext}", ctype


def _matches(order: dict, q: str) -> bool:
    c = order["customer"]
    return any(q in s.lower() for s in (order["id"], c["name"], c["phone"], c["email"]))


class LocalStore:
    kind = "local"

    def __init__(self, root: Path):
        self.root, self.orders, self.uploads = root, root / "orders", root / "uploads"
        self.lock = threading.Lock()
        secret_file = root / "local-secret"
        if not secret_file.is_file():
            root.mkdir(parents=True, exist_ok=True)
            secret_file.write_text(secrets.token_hex(32), encoding="utf-8")
        self.secret = secret_file.read_text(encoding="utf-8").strip().encode()

    # -- orders
    def _path(self, order_id: str) -> Path | None:
        return self.orders / f"{order_id}.json" if ORDER_ID.match(order_id or "") else None

    def _write(self, path: Path, order: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(order, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(path)

    def _all(self) -> list:
        if not self.orders.is_dir():
            return []
        return [json.loads(p.read_text(encoding="utf-8")) for p in self.orders.glob("KP-*.json")]

    def create_order(self, order: dict) -> dict:
        with self.lock:
            path = self._path(order["id"])
            if path.exists():
                raise Conflict(order["id"])
            self._write(path, order)
        return order

    def get_order(self, order_id: str) -> dict | None:
        path = self._path(order_id)
        return json.loads(path.read_text(encoding="utf-8")) if path and path.is_file() else None

    def find_by_razorpay_order(self, razorpay_order_id: str) -> dict | None:
        return next((o for o in self._all() if o.get("razorpay_order_id") == razorpay_order_id), None)

    def update_order(self, order_id: str, changes: dict, expect: tuple | None = None) -> dict | None:
        """Apply `changes`; with `expect`, only if the current status is one of those (else None)."""
        with self.lock:
            order = self.get_order(order_id)
            if not order or (expect and order["status"] not in expect):
                return None
            order.update(changes)
            self._write(self._path(order_id), order)
            return order

    def list_orders(self, statuses: tuple | None = None, q: str = "", limit: int = 200, oldest_first: bool = False) -> list:
        rows = sorted(self._all(), key=lambda o: o["created_at"], reverse=not oldest_first)
        if statuses:
            rows = [o for o in rows if o["status"] in statuses]
        if q:
            rows = [o for o in rows if _matches(o, q.lower())]
        return rows[:limit]

    def status_counts(self) -> dict:
        return dict(Counter(o["status"] for o in self._all()))

    def latest_change(self) -> str:
        return max((o["updated_at"] for o in self._all()), default="")

    def delete_order(self, order_id: str) -> None:
        path = self._path(order_id)
        if path:
            with self.lock:
                path.unlink(missing_ok=True)

    # -- photos
    def delete_photos(self, keys: list) -> None:
        for key in keys:
            if PHOTO_KEY.match(key or ""):
                (self.uploads / key).unlink(missing_ok=True)

    def _sig(self, key: str) -> str:
        return hmac.new(self.secret, key.encode(), hashlib.sha256).hexdigest()

    def upload_targets(self, files: list) -> list:
        return [{"key": key, "method": "PUT", "headers": {"Content-Type": ctype},
                 "url": f"/api/upload-local/?key={urllib.parse.quote(key)}&sig={self._sig(key)}"} for key, ctype in files]

    def valid_upload(self, key: str, sig: str) -> bool:
        return bool(PHOTO_KEY.match(key or "")) and hmac.compare_digest(self._sig(key), sig or "")

    def save_upload(self, key: str, data: bytes) -> None:
        path = self.uploads / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def photo_urls(self, keys: list) -> dict:
        return {k: f"/api/admin/photo/?key={urllib.parse.quote(k)}" for k in keys}

    def read_photo(self, key: str) -> bytes | None:
        if not PHOTO_KEY.match(key or ""):
            return None
        path = self.uploads / key
        return path.read_bytes() if path.is_file() else None


class SupabaseStore:
    kind = "supabase"

    def __init__(self, url: str, key: str, bucket: str):
        self.url, self.key, self.bucket = url, key, bucket

    def _req(self, method: str, path: str, body=None, headers: dict | None = None, timeout: float = 10):
        hdrs = {"apikey": self.key, "Content-Type": "application/json", **(headers or {})}
        if self.key.startswith("eyJ"):  # legacy service_role JWT also goes in Authorization
            hdrs["Authorization"] = f"Bearer {self.key}"
        req = urllib.request.Request(self.url + path, method=method, headers=hdrs,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                raw = res.read()
                return res.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                return exc.code, json.loads(raw)
            except ValueError:
                return exc.code, {"message": raw.decode("utf-8", "replace")[:200]}
        except (urllib.error.URLError, TimeoutError, OSError):
            raise StoreError("Couldn't reach Supabase") from None

    @staticmethod
    def _ok(status: int, data, what: str):
        if status >= 300:
            msg = (data.get("message") or data.get("error") or "") if isinstance(data, dict) else ""
            raise StoreError(f"{what} failed (HTTP {status}{': ' + str(msg) if msg else ''})")
        return data

    @staticmethod
    def _q(value: str) -> str:
        return urllib.parse.quote(value, safe="")

    # -- orders
    def create_order(self, order: dict) -> dict:
        status, data = self._req("POST", "/rest/v1/orders", order, {"Prefer": "return=representation"})
        if status == 409:
            raise Conflict(order["id"])
        return self._ok(status, data, "Saving the order")[0]

    def _one(self, column: str, value: str) -> dict | None:
        status, data = self._req("GET", f"/rest/v1/orders?select=*&{column}=eq.{self._q(value)}")
        rows = self._ok(status, data, "Loading the order")
        return rows[0] if rows else None

    def get_order(self, order_id: str) -> dict | None:
        return self._one("id", order_id) if ORDER_ID.match(order_id or "") else None

    def find_by_razorpay_order(self, razorpay_order_id: str) -> dict | None:
        return self._one("razorpay_order_id", razorpay_order_id)

    def update_order(self, order_id: str, changes: dict, expect: tuple | None = None) -> dict | None:
        path = f"/rest/v1/orders?id=eq.{self._q(order_id)}"
        if expect:  # conditional update = safe against the browser and the webhook racing each other
            path += "&status=in.(" + ",".join(expect) + ")"
        status, data = self._req("PATCH", path, changes, {"Prefer": "return=representation"})
        rows = self._ok(status, data, "Updating the order")
        return rows[0] if rows else None

    def list_orders(self, statuses: tuple | None = None, q: str = "", limit: int = 200, oldest_first: bool = False) -> list:
        params = f"select=*&order=created_at.{'asc' if oldest_first else 'desc'}&limit={int(limit)}"
        if statuses:
            params += "&status=in.(" + ",".join(statuses) + ")"
        safe = re.sub(r"[^\w@.+\- ]", "", q or "").strip()[:60]
        if safe:
            pat = f"*{safe}*"
            params += "&or=" + self._q(f"(id.ilike.{pat},customer->>name.ilike.{pat},customer->>phone.ilike.{pat},customer->>email.ilike.{pat})")
        status, data = self._req("GET", "/rest/v1/orders?" + params)
        return self._ok(status, data, "Loading orders")

    def status_counts(self) -> dict:
        status, data = self._req("GET", "/rest/v1/orders?select=status&limit=10000")
        return dict(Counter(r["status"] for r in self._ok(status, data, "Counting orders")))

    def latest_change(self) -> str:
        """Newest updated_at of any order: one tiny row, so the dashboard can poll it cheaply."""
        status, data = self._req("GET", "/rest/v1/orders?select=updated_at&order=updated_at.desc&limit=1")
        rows = self._ok(status, data, "Checking for changes")
        return rows[0]["updated_at"] if rows else ""

    def delete_order(self, order_id: str) -> None:
        if ORDER_ID.match(order_id or ""):
            self._ok(*self._req("DELETE", f"/rest/v1/orders?id=eq.{self._q(order_id)}"), "Deleting the order")

    def delete_photos(self, keys: list) -> None:
        keys = [k for k in keys if PHOTO_KEY.match(k or "")]
        if keys:
            self._ok(*self._req("DELETE", f"/storage/v1/object/{self.bucket}", {"prefixes": keys}), "Deleting photos")

    # -- photos
    def _sign_upload(self, item: tuple) -> dict:
        key, ctype = item
        status, data = self._req("POST", f"/storage/v1/object/upload/sign/{self.bucket}/{key}", {})
        rel = self._ok(status, data, "Preparing the photo upload")["url"]
        return {"key": key, "method": "PUT", "url": f"{self.url}/storage/v1{rel}",
                "headers": {"Content-Type": ctype, "x-upsert": "false"}}

    def upload_targets(self, files: list) -> list:
        with ThreadPoolExecutor(max_workers=8) as pool:
            return list(pool.map(self._sign_upload, files))

    def photo_urls(self, keys: list, expires: int = 3600) -> dict:
        if not keys:
            return {}
        status, data = self._req("POST", f"/storage/v1/object/sign/{self.bucket}", {"expiresIn": expires, "paths": keys})
        rows = self._ok(status, data, "Loading photos")
        return {r["path"]: f"{self.url}/storage/v1{r['signedURL']}" for r in rows if r.get("signedURL")}


def make_store(cfg) -> LocalStore | SupabaseStore | None:
    if cfg.storage == "supabase":
        return SupabaseStore(cfg.supabase_url, cfg.supabase_key, cfg.supabase_bucket)
    if cfg.storage == "local":
        return LocalStore(cfg.data_dir)
    return None
