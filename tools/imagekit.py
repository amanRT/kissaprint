"""Image helpers shared by the asset scripts: focal-point crops and responsive AVIF/WebP encoding.

Every encoded image is recorded in src/data/images.json so templates can emit srcset/width/height.
"""
import json
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "src" / "data" / "images.json"
STATIC = ROOT / "src" / "static"


def crop_to_aspect(img: Image.Image, aspect: float, focal=(0.5, 0.5), zoom=1.0) -> Image.Image:
    """Crop to width/height == aspect around the focal point (0..1, 0..1).

    zoom < 1 crops tighter (e.g. 0.4 keeps 40% of the largest possible crop) - handy for avatars.
    """
    img = ImageOps.exif_transpose(img).convert("RGB")
    w, h = img.size
    cw, ch = (round(h * aspect), h) if w / h > aspect else (w, round(w / aspect))
    cw, ch = round(cw * zoom), round(ch * zoom)
    left = min(max(round(focal[0] * w - cw / 2), 0), w - cw)
    top = min(max(round(focal[1] * h - ch / 2), 0), h - ch)
    return img.crop((left, top, left + cw, top + ch))


def _load_manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}


def encode_variants(img: Image.Image, out_dir: Path, name: str, widths, group: str,
                    avif_q=56, webp_q=78) -> list:
    """Write <name>-<w>.avif/.webp for each width (never upscaling) and register them in the manifest."""
    out_dir.mkdir(parents=True, exist_ok=True)
    img = img.convert("RGB")
    aspect = img.width / img.height
    done, report = [], []
    for w in sorted(widths):
        w = min(w, img.width)
        if w in done:
            continue
        h = round(w / aspect)
        im = img.resize((w, h), Image.LANCZOS)
        avif, webp = out_dir / f"{name}-{w}.avif", out_dir / f"{name}-{w}.webp"
        im.save(avif, "AVIF", quality=avif_q, speed=5)
        im.save(webp, "WEBP", quality=webp_q, method=6)
        done.append(w)
        report.append(f"{w}w {avif.stat().st_size // 1024}K/{webp.stat().st_size // 1024}K")
    manifest = _load_manifest()
    rel = "/" + out_dir.relative_to(STATIC).as_posix()
    manifest[name] = {"src": f"{rel}/{name}", "widths": done, "width": done[-1],
                      "height": round(done[-1] / aspect), "group": group}
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), indent=1), encoding="utf-8")
    return report
