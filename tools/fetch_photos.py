"""Download the source photos listed in design/photos.json from the Pexels public CDN.

Usage: python tools/fetch_photos.py
Originals land in design/source-photos/ (not deployed). A CREDITS.md is written alongside.
"""
import concurrent.futures as cf
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design" / "photos.json"
OUT = ROOT / "design" / "source-photos"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KissaPrintsDesign/1.0"}


def fetch(item):
    name, pid = item
    dest = OUT / f"{name}.jpg"
    if dest.exists():
        return name, "cached"
    url = f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?auto=compress&cs=tinysrgb&w=1800"
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        dest.write_bytes(r.read())
    return name, f"{dest.stat().st_size // 1024} KB"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    photos = json.loads(SRC.read_text(encoding="utf-8"))["photos"]
    with cf.ThreadPoolExecutor(8) as ex:
        for name, status in ex.map(fetch, photos.items()):
            print(f"{name:18} {status}")
    lines = ["# Photo credits", "", "Placeholder photos from Pexels, used under the Pexels License "
             "(https://www.pexels.com/license/). Replace with original product photography before launch.", ""]
    lines += [f"- `{n}.jpg` - https://www.pexels.com/photo/{pid}/" for n, pid in photos.items()]
    (OUT / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
