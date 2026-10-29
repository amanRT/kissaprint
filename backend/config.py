"""Settings come from environment variables: Vercel project settings in production, a .env file locally.

Without Razorpay keys or Supabase credentials the backend falls back to local stand-ins, but only off
Vercel: a fake payment step and a .data/ folder. On Vercel a missing setting switches that feature off
with a clear error instead of pretending to work.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Minimal .env reader for local development: KEY=VALUE lines; real environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


@dataclass(frozen=True)
class Settings:
    on_vercel: bool
    razorpay_key_id: str
    razorpay_key_secret: str
    razorpay_webhook_secret: str
    supabase_url: str
    supabase_key: str
    supabase_bucket: str
    admin_password: str
    session_secret: str
    data_dir: Path
    test_phones: tuple = ()  # team numbers whose orders skip payment (always labelled "Test")

    @property
    def payments(self) -> str:
        """'razorpay', 'mock' (local only) or '' (not configured)."""
        if self.razorpay_key_id and self.razorpay_key_secret:
            return "razorpay"
        return "" if self.on_vercel else "mock"

    @property
    def storage(self) -> str:
        """'supabase', 'local' (local only) or '' (not configured)."""
        if self.supabase_url and self.supabase_key and not self.supabase_key.startswith("sb_publishable_"):
            return "supabase"
        return "" if self.on_vercel else "local"

    @property
    def problems(self) -> list:
        """Setup mistakes, shown on /api/health/ and in the admin header so they're easy to spot."""
        issues = []
        if self.supabase_key.startswith("sb_publishable_"):
            issues.append("SUPABASE_SECRET_KEY holds the publishable key - use the secret key (sb_secret_...)")
        if bool(self.supabase_url) != bool(self.supabase_key):
            issues.append("Set both SUPABASE_URL and SUPABASE_SECRET_KEY")
        if bool(self.razorpay_key_id) != bool(self.razorpay_key_secret):
            issues.append("Set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET")
        elif self.razorpay_key_id and not self.razorpay_key_id.startswith(("rzp_test_", "rzp_live_")):
            issues.append("RAZORPAY_KEY_ID should start with rzp_test_ or rzp_live_")
        if self.payments == "razorpay" and not self.razorpay_webhook_secret:
            issues.append("RAZORPAY_WEBHOOK_SECRET isn't set - payments work, but orders aren't confirmed if a shopper closes the tab")
        if self.on_vercel and not self.admin_password:
            issues.append("ADMIN_PASSWORD isn't set - the dashboard stays locked")
        elif self.on_vercel and len(self.admin_password) < 12:
            issues.append("ADMIN_PASSWORD is short - use at least 12 characters")
        return issues

    @property
    def test_mode(self) -> bool:
        """True unless real money can move (live Razorpay keys)."""
        return not (self.payments == "razorpay" and self.razorpay_key_id.startswith("rzp_live_"))


def settings() -> Settings:
    env = os.environ.get
    on_vercel = bool(env("VERCEL"))
    return Settings(
        on_vercel=on_vercel,
        razorpay_key_id=env("RAZORPAY_KEY_ID", "").strip(),
        razorpay_key_secret=env("RAZORPAY_KEY_SECRET", "").strip(),
        razorpay_webhook_secret=env("RAZORPAY_WEBHOOK_SECRET", "").strip(),
        # Accept the dashboard's "API URL" too (…supabase.co/rest/v1/): the code adds /rest/v1 and /storage/v1 itself.
        supabase_url=re.sub(r"/rest/v1/?$", "", (env("SUPABASE_URL") or env("NEXT_PUBLIC_SUPABASE_URL") or "").strip()).rstrip("/"),
        # New-style secret key (sb_secret_...) or the legacy service_role key - both bypass row-level security.
        supabase_key=(env("SUPABASE_SECRET_KEY") or env("SUPABASE_SERVICE_ROLE_KEY") or "").strip(),
        supabase_bucket=env("SUPABASE_BUCKET", "order-photos").strip(),
        # Local development falls back to "admin" so the dashboard works out of the box; Vercel requires a real one.
        admin_password=env("ADMIN_PASSWORD", "") or ("" if on_vercel else "admin"),
        session_secret=env("SESSION_SECRET", ""),
        data_dir=Path(env("KP_DATA_DIR") or ROOT / ".data"),
        # Kept in env vars, not in code: the repo is public and these numbers order without paying.
        test_phones=tuple(n for n in (re.sub(r"\D", "", p)[-10:] for p in re.split(r"[,;\n]+", env("TEST_PHONES", "")))
                          if re.fullmatch(r"[6-9]\d{9}", n)),
    )
