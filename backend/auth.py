"""Admin sign-in: one shared password (ADMIN_PASSWORD) and a signed, HttpOnly session cookie.

The cookie is `<expiry>.<hmac>`, keyed by the password (plus SESSION_SECRET if set), so changing the
password signs everyone out. SameSite=Strict + JSON-only endpoints keep other sites from using it.
"""
from __future__ import annotations

import hashlib
import hmac
import time

COOKIE = "kp_admin"
SESSION_HOURS = 12


def _key(cfg) -> bytes:
    return hashlib.sha256(f"kp-admin-session|{cfg.admin_password}|{cfg.session_secret}".encode()).digest()


def check_password(cfg, password) -> bool:
    if not cfg.admin_password:
        return False
    # Compare digests so the check takes the same time whatever the input length.
    given = hashlib.sha256(str(password or "").encode()).digest()
    return hmac.compare_digest(given, hashlib.sha256(cfg.admin_password.encode()).digest())


def issue(cfg) -> str:
    expires = int(time.time()) + SESSION_HOURS * 3600
    return f"{expires}.{hmac.new(_key(cfg), str(expires).encode(), hashlib.sha256).hexdigest()}"


def valid(cfg, token) -> bool:
    if not cfg.admin_password or not token or "." not in token:
        return False
    expires, _, sig = token.partition(".")
    if not expires.isdigit() or int(expires) < time.time():
        return False
    return hmac.compare_digest(sig, hmac.new(_key(cfg), expires.encode(), hashlib.sha256).hexdigest())


def cookie(token: str, secure: bool, max_age: int = SESSION_HOURS * 3600) -> str:
    return (f"{COOKIE}={token}; Path=/api/admin; Max-Age={max_age}; HttpOnly; SameSite=Strict"
            + ("; Secure" if secure else ""))
