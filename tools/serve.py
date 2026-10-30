"""Small static server for the design studio (design/mockups/studio.html) and the image pipeline.

Usage:
    python tools/serve.py                       # serves design/ on http://localhost:8090
    python tools/serve.py --root design --port 8090
The website itself runs on Next.js: `npm run dev` (or `npm run build && npm start`).
"""
import argparse
import gzip
import http.server
import sys
import threading
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPRESSIBLE = {".html", ".css", ".js", ".svg", ".json", ".xml", ".txt", ".webmanifest", ".ico"}
TYPES = {".webmanifest": "application/manifest+json", ".avif": "image/avif", ".webp": "image/webp",
         ".woff2": "font/woff2", ".svg": "image/svg+xml", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".xml": "application/xml",
         ".txt": "text/plain; charset=utf-8", ".json": "application/json"}


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
        if not path.is_file():
            self.send_error(404)
            return None
        data = path.read_bytes()
        ext = path.suffix.lower()
        gz = ext in COMPRESSIBLE and "gzip" in self.headers.get("Accept-Encoding", "")
        if gz:
            data = gzip.compress(data, 6)
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(ext) or self.guess_type(str(path)))
        self.send_header("Content-Length", str(len(data)))
        if gz:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self._body = data
        return self

    def do_GET(self):
        if self.send_head():
            self.wfile.write(self._body)

    def do_HEAD(self):
        self.send_head()


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            super().handle_error(request, client_address)


def start_background(root: Path, port: int = 0):
    """Start a server thread for `root`; returns (server, base_url). Port 0 picks a free port."""
    server = Server(("127.0.0.1", port), partial(Handler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="design")
    ap.add_argument("--port", type=int, default=8090)
    args = ap.parse_args()
    directory = (ROOT / args.root).resolve()
    server = Server(("127.0.0.1", args.port), partial(Handler, directory=str(directory)))
    print(f"Serving {directory} at http://localhost:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
