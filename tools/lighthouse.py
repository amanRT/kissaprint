"""Run Lighthouse against the built site and summarise scores + anything that needs attention.

Usage:
    python tools/lighthouse.py                      # key pages, mobile + desktop
    python tools/lighthouse.py / --form-factor mobile
Needs Node.js 20+ and `npm install` (installs lighthouse into node_modules). Set NODE=... to use a specific node.
Reports land in qa/lighthouse/*.json (open them at https://googlechrome.github.io/lighthouse/viewer/).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nextserver import start_next  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "qa" / "lighthouse"
DEFAULT_PAGES = ["/", "/shop/", "/products/classic-memoroids/", "/gifts/for-couples/", "/about/"]
METRICS = [("first-contentful-paint", "FCP"), ("largest-contentful-paint", "LCP"), ("total-blocking-time", "TBT"),
           ("cumulative-layout-shift", "CLS"), ("speed-index", "SI")]


def find_node():
    for candidate in (os.environ.get("NODE"), shutil.which("node")):
        if candidate and Path(candidate).exists():
            return candidate
    sys.exit("Node.js 20+ is required: install it from https://nodejs.org or set NODE=path\\to\\node")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", nargs="*", default=DEFAULT_PAGES)
    ap.add_argument("--form-factor", choices=["mobile", "desktop", "both"], default="both")
    args = ap.parse_args()
    cli = ROOT / "node_modules" / "lighthouse" / "cli" / "index.js"
    if not cli.exists():
        sys.exit("Lighthouse not installed - run `npm install` in the project root first.")
    node = find_node()
    OUT.mkdir(parents=True, exist_ok=True)
    server, base = start_next()
    factors = ["mobile", "desktop"] if args.form_factor == "both" else [args.form_factor]
    worst = 100
    try:
        for page in args.pages:
            for ff in factors:
                name = (re.sub(r"[^a-z0-9]+", "-", page.strip("/")) or "home") + f"-{ff}"
                report = OUT / f"{name}.json"
                cmd = [node, str(cli), base + page, "--quiet", "--output=json", f"--output-path={report}",
                       "--only-categories=performance,accessibility,best-practices,seo",
                       "--chrome-flags=--headless=new --no-first-run"]
                if ff == "desktop":
                    cmd.append("--preset=desktop")
                subprocess.run(cmd, check=True)
                data = json.loads(report.read_text(encoding="utf-8"))
                scores = {k: round((v["score"] or 0) * 100) for k, v in data["categories"].items()}
                worst = min(worst, *scores.values())
                metrics = "  ".join(f"{label} {data['audits'][key]['displayValue']}" for key, label in METRICS)
                print(f"{page:32} {ff:7}  perf {scores['performance']:3}  a11y {scores['accessibility']:3}  "
                      f"bp {scores['best-practices']:3}  seo {scores['seo']:3}   {metrics}")
                for cat_id, cat in data["categories"].items():
                    for ref in cat["auditRefs"]:
                        audit = data["audits"][ref["id"]]
                        if ref.get("weight", 0) > 0 and audit.get("score") is not None and audit["score"] < 0.9:
                            print(f"      ! {cat_id:15} {audit['id']}: {audit['title']} {audit.get('displayValue', '')}")
    finally:
        server.terminate()
    print(f"reports -> {OUT}   (lowest score: {worst})")


if __name__ == "__main__":
    main()
