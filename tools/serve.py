"""Local server that behaves like production: gzip, cache headers, clean URLs, 404 page - plus the
order API under /api/ (the same backend/ code Vercel runs), so checkout and /admin/ work locally.

Usage:
    python tools/serve.py                 # serves dist/ on http://localhost:8080
    python tools/serve.py --watch         # also rebuilds dist/ whenever src/ changes
    python tools/serve.py --root design --port 8090

Without Razorpay/Supabase settings (see .env.example) the API uses a fake payment step and stores
orders and photos in .data/. Admin password locally: ADMIN_PASSWORD from .env, else "admin".
"""
import argparse
import gzip
import http.server
import socket
import subprocess
import sys
import threading
import time
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend import config as backend_config  # noqa: E402
from backend import web as backend_web  # noqa: E402

COMPRESSIBLE = {".html", ".css", ".js", ".svg", ".json", ".xml", ".txt", ".webmanifest", ".ico"}
TYPES = {".webmanifest": "application/manifest+json", ".avif": "image/avif", ".webp": "image/webp",
         ".woff2": "font/woff2", ".svg": "image/svg+xml", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".xml": "application/xml",
         ".txt": "text/plain; charset=utf-8", ".json": "application/json"}


def prefer_ipv4():
    """Look up IPv4 addresses first for the API's outgoing calls (Supabase, Razorpay). Some home routers
    stall ~11 s on IPv6 lookups, which made every local Supabase call slow. Dev server only."""
    original = socket.getaddrinfo
    if getattr(original, "kp_ipv4_first", False):
        return

    def getaddrinfo(host, port, family=0, *args, **kwargs):
        if family == 0:
            try:
                return original(host, port, socket.AF_INET, *args, **kwargs)
            except socket.gaierror:
                pass  # IPv6-only host: fall through to the normal lookup
        return original(host, port, family, *args, **kwargs)

    getaddrinfo.kp_ipv4_first = True
    socket.getaddrinfo = getaddrinfo


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # keep the console quiet except for errors
        if len(args) > 1 and str(args[1])[:1] in ("4", "5"):
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def send_head(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            if not self.path.split("?")[0].endswith("/"):
                self.send_response(301)
                self.send_header("Location", self.path.split("?")[0] + "/")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            path = path / "index.html"
        status = 200
        if not path.is_file():
            path, status = Path(self.directory) / "404.html", 404
            if not path.is_file():
                self.send_error(404)
                return None
        data = path.read_bytes()
        ext = path.suffix.lower()
        gz = ext in COMPRESSIBLE and "gzip" in self.headers.get("Accept-Encoding", "")
        if gz:
            data = gzip.compress(data, 6)
        self.send_response(status)
        self.send_header("Content-Type", TYPES.get(ext) or self.guess_type(str(path)))
        self.send_header("Content-Length", str(len(data)))
        if gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        if "/assets/" in self.path:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self._body = data
        return self

    def _api(self) -> bool:
        if self.path == "/api" or self.path.startswith("/api/"):
            backend_web.handle(self)
            return True
        return False

    def do_GET(self):
        if not self._api() and self.send_head():
            self.wfile.write(self._body)

    def do_HEAD(self):
        if not self._api():
            self.send_head()

    def do_POST(self):
        if not self._api():
            self.send_error(405)

    do_PUT = do_DELETE = do_POST


def watch_and_build():
    src = ROOT / "src"
    last = None
    while True:
        stamp = max((p.stat().st_mtime for p in src.rglob("*") if p.is_file()), default=0)
        if stamp != last:
            if last is not None:
                print("change detected - rebuilding")
            subprocess.run([sys.executable, str(ROOT / "tools" / "build.py")], check=False)
            last = stamp
        time.sleep(1)


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            super().handle_error(request, client_address)


def start_background(root: Path, port: int = 0):
    """Start a server thread for `root`; returns (server, base_url). Port 0 picks a free port."""
    backend_config.load_dotenv()
    prefer_ipv4()
    server = Server(("127.0.0.1", port), partial(Handler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="dist")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--watch", action="store_true")
    args = ap.parse_args()
    directory = (ROOT / args.root).resolve()
    if args.watch:
        threading.Thread(target=watch_and_build, daemon=True).start()
    # No os.chdir() into the served folder: on Windows that would block the rebuild from clearing it.
    backend_config.load_dotenv()
    prefer_ipv4()
    cfg = backend_config.settings()
    server = Server(("127.0.0.1", args.port), partial(Handler, directory=str(directory)))
    print(f"Serving {directory} at http://localhost:{args.port}/")
    print(f"Order API: payments={cfg.payments}, storage={cfg.storage}"
          f"{' (' + str(cfg.data_dir) + ')' if cfg.storage == 'local' else ''} - admin at http://localhost:{args.port}/admin/")
    for problem in cfg.problems:
        print(f"  ! {problem}")
    server.serve_forever()


if __name__ == "__main__":
    main()
