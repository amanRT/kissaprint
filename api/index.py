"""Vercel Function entry point. vercel.json rewrites every /api/* request here; backend/ does the routing."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.web import Handler  # noqa: E402


class handler(Handler):  # Vercel looks for a BaseHTTPRequestHandler subclass named `handler`
    pass
