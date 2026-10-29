"""HTTP plumbing shared by the Vercel Function (api/index.py) and the local dev server (tools/serve.py).

Both speak http.server.BaseHTTPRequestHandler, so `handle(handler)` serves either one.
"""
from __future__ import annotations

import json
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit

MAX_JSON = 512 * 1024
MAX_UPLOAD = 26 * 1024 * 1024  # local photo uploads only; production uploads go straight to Supabase


class ApiError(Exception):
    def __init__(self, status: int, message: str, field: str | None = None):
        super().__init__(message)
        self.status, self.field = status, field


def route_of(path: str, query: dict) -> str:
    """'/api/admin/orders/' -> 'admin/orders'. On Vercel the rewrite (/api/:route* -> /api/index) also
    passes the matched path as ?route=..., which wins if present."""
    if query.get("route"):
        route = "/".join(query["route"])
    else:
        route = path[4:] if path.startswith("/api") else path
    route = route.strip("/")
    return "" if route == "index" else route


class Request:
    def __init__(self, method: str, target: str, headers, body: bytes = b"", client_ip: str = ""):
        parts = urlsplit(target)
        raw = parse_qs(parts.query, keep_blank_values=True)
        self.method = method.upper()
        self.path = parts.path
        self.route = route_of(parts.path, raw)
        self.query = {k: v[0] for k, v in raw.items() if k != "route"}
        self.headers = headers  # case-insensitive .get(), like email.message.Message
        self.body = body
        self.client_ip = client_ip

    def json(self) -> dict:
        if not self.body:
            return {}
        if "json" not in (self.headers.get("Content-Type") or ""):
            raise ApiError(415, "Send JSON")  # also stops cross-site form posts
        try:
            data = json.loads(self.body)
        except ValueError:
            raise ApiError(400, "Invalid JSON") from None
        if not isinstance(data, dict):
            raise ApiError(400, "Expected a JSON object")
        return data

    def cookie(self, name: str) -> str:
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie") or "")
        except CookieError:
            return ""
        return jar[name].value if name in jar else ""

    @property
    def secure(self) -> bool:
        return (self.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip() == "https"

    @property
    def origin(self) -> str:
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "localhost"
        return f"{'https' if self.secure else 'http'}://{host}"


class Response:
    def __init__(self, status: int = 200, body: bytes = b"", content_type: str = "application/json; charset=utf-8",
                 headers: list | None = None):
        self.status, self.body, self.content_type, self.headers = status, body, content_type, headers or []

    @classmethod
    def json(cls, data, status: int = 200, headers: list | None = None) -> "Response":
        return cls(status, json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode(), headers=headers)


def handle(h: BaseHTTPRequestHandler) -> None:
    from . import app  # imported here so web.py has no import cycle with app.py

    target = h.path
    raw_query = parse_qs(urlsplit(target).query)
    limit = MAX_UPLOAD if route_of(urlsplit(target).path, raw_query) == "upload-local" else MAX_JSON
    try:
        length = int(h.headers.get("Content-Length") or 0)
    except ValueError:
        length = -1
    too_big = length < 0 or length > limit
    if too_big:
        resp = Response.json({"error": "That request is too large"}, 413)
    else:
        body = h.rfile.read(length) if length else b""
        ip = (h.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or h.client_address[0]
        resp = app.dispatch(Request(h.command, target, h.headers, body, ip))
    h.send_response(resp.status)
    h.send_header("Content-Type", resp.content_type)
    h.send_header("Content-Length", str(len(resp.body)))
    h.send_header("Cache-Control", "no-store")
    h.send_header("X-Content-Type-Options", "nosniff")
    h.send_header("X-Robots-Tag", "noindex")
    for key, value in resp.headers:
        h.send_header(key, value)
    if too_big:  # the unread body is still on the socket
        h.send_header("Connection", "close")
        h.close_connection = True
    h.end_headers()
    if h.command != "HEAD":
        h.wfile.write(resp.body)


class Handler(BaseHTTPRequestHandler):
    """Every method goes through the same router."""

    def do_GET(self):
        handle(self)

    do_POST = do_PUT = do_HEAD = do_DELETE = do_GET
