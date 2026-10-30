"""Start the built Next.js app for the QA scripts (shoot.py, lighthouse.py, checkout_test.py).

    from nextserver import start_next
    proc, base = start_next(env={"KP_DATA_DIR": "..."})   # build first: npm run build
    ...
    proc.terminate()

Needs Node.js 20.9+ on PATH, or NODE=path\\to\\node.
"""
import os
import shutil
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def node() -> str:
    for candidate in (os.environ.get("NODE"), shutil.which("node")):
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit("Node.js 20.9+ is required: install it from https://nodejs.org or set NODE=path\\to\\node")


def run_node(*args, env=None, check=True):
    """Run a Node CLI from node_modules (e.g. tsx) with the project's settings plus `env`."""
    return subprocess.run([node(), *args], cwd=ROOT, env={**os.environ, **(env or {})}, check=check, capture_output=True, text=True)


def start_next(env=None, port=0):
    if not (ROOT / ".next" / "BUILD_ID").exists():
        raise SystemExit("No production build found - run `npm run build` first")
    if not port:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
    cli = ROOT / "node_modules" / "next" / "dist" / "bin" / "next"
    proc = subprocess.Popen([node(), str(cli), "start", "-p", str(port), "-H", "127.0.0.1"], cwd=ROOT,
                            env={**os.environ, "NEXT_TELEMETRY_DISABLED": "1", **(env or {})},
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(base + "/api/health/", timeout=2)
            return proc, base
        except OSError:
            if proc.poll() is not None:
                raise SystemExit("next start exited early - is the build up to date?") from None
            time.sleep(0.5)
    proc.terminate()
    raise SystemExit("next start didn't come up within a minute")
