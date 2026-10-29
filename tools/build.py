"""Build the static site: src/ -> dist/.

Usage:
    python tools/build.py                 # build dist/ (stylesheet inlined into each page - fastest first visit)
    python tools/build.py --external-css  # link one cached stylesheet instead (fewer bytes on repeat page views)

Pages are Jinja2 templates fed by src/data/catalog.json. Everything under src/static/assets/ (plus the
compiled CSS/JS) is fingerprinted - name.<hash>.ext - so it can be cached forever.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined
from markupsafe import Markup, escape

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
sys.path.insert(0, str(ROOT))
from backend.catalog import default_index  # noqa: E402 - same pre-selection rule as the server's pricing

SCRIPTS = ["main", "checkout", "order", "admin"]  # src/js/<name>.js -> /assets/js/<name>.<hash>.js

NAV_GROUPS = [
    ("Prints & keepsakes", ["memoroids", "photo-strips", "boarding-passes", "newspapers"]),
    ("Gifts that last", ["song-plaques", "keychains", "fridge-magnets", "hampers"]),
    ("Wall & desk", ["star-maps", "frames", "calendars", "magazines"]),
]

INFO_PAGES = {
    # slug: (title tag, H1, intro, meta description)
    "about": ("Our Story | KissaPrints", "Every photo has a *kissa*.",
              "We're a small team in India turning camera-roll moments into keepsakes you can hold, gift and keep.",
              "The story behind KissaPrints - personalised photo gifts designed, printed and packed with care in India."),
    "contact": ("Contact Us | KissaPrints", "Talk to a real *human*",
                "Questions about an order, a custom idea or bulk gifting? We usually reply within a few hours.",
                "Contact KissaPrints for help with orders, custom personalised gifts and bulk orders."),
    "faq": ("FAQs - Orders, Photos & Delivery | KissaPrints", "Frequently asked *questions*",
            "Everything about sending photos, previews, delivery, payments and our reprint promise.",
            "Answers to common questions about KissaPrints orders, photo uploads, print quality, delivery and payments."),
    "bulk-orders": ("Bulk & Corporate Gifting | KissaPrints", "Bulk & corporate *gifting*",
                    "Personalised gifts for weddings, events and teams - from 25 units, with your branding.",
                    "Personalised bulk and corporate gifts from KissaPrints - hampers, keychains, calendars and more from 25 units."),
    "shipping": ("Shipping & Delivery | KissaPrints", "Shipping & delivery",
                 "How quickly we dispatch, where we deliver and what shipping costs.",
                 "KissaPrints shipping policy: dispatch within 48 hours and delivery across India in 5-7 working days."),
    "returns": ("Returns & Reprints | KissaPrints", "Returns & reprints",
                "Personalised gifts can't be returned for change of mind - but we'll always make things right.",
                "KissaPrints returns, cancellations and reprint promise for damaged or misprinted personalised gifts."),
    "privacy": ("Privacy Policy | KissaPrints", "Privacy policy", "How we collect, use and protect your information and photos.",
                "How KissaPrints collects, uses and protects your personal information and photos."),
    "terms": ("Terms of Service | KissaPrints", "Terms of service", "The terms that apply when you use KissaPrints.",
              "Terms of service for using kissaprints.com and ordering personalised photo gifts."),
    "track-order": ("Track Your Order | KissaPrints", "Track your order", "Enter your order number to see where your keepsake is.",
                    "Track your KissaPrints order with your order number and email or phone."),
    "thank-you": ("Thank You | KissaPrints", "Thank you!", "", "Thanks for getting in touch with KissaPrints."),
}

OCCASION_TAG = {"for-couples": "couples", "for-her": "her", "for-him": "him", "for-friends": "friends", "for-parents": "parents"}


# ---------------------------------------------------------------- assets
class Assets:
    """Writes fingerprinted copies into dist/ and resolves source URLs to hashed URLs."""

    def __init__(self):
        self.map = {}

    def add(self, url: str, data: bytes) -> str:
        p = Path(url)
        hashed = f"{p.parent.as_posix()}/{p.stem}.{hashlib.sha256(data).hexdigest()[:10]}{p.suffix}"
        out = DIST / hashed.lstrip("/")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        self.map[url] = hashed
        return hashed

    def __call__(self, url: str) -> str:
        try:
            return self.map[url]
        except KeyError:
            raise KeyError(f"Unknown asset: {url}") from None


def minify_css(css: str) -> str:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};,>])\s*", r"\1", css)
    return css.replace(";}", "}").strip()


def minify_js(js: str) -> str:
    """Conservative: drops block comments that start a line, // comment lines and indentation."""
    js = re.sub(r"^[ \t]*/\*.*?\*/[ \t]*$", "", js, flags=re.S | re.M)
    lines = [ln.strip() for ln in js.splitlines()]
    return "\n".join(ln for ln in lines if ln and not ln.startswith("//"))


def minify_html(html: str) -> str:
    html = re.sub(r"<!--(?!\[).*?-->", "", html, flags=re.S)
    html = re.sub(r"\n\s+", "\n", html)
    return re.sub(r"\n{2,}", "\n", html).strip() + "\n"


# ---------------------------------------------------------------- data
def load_data():
    catalog = json.loads((SRC / "data" / "catalog.json").read_text(encoding="utf-8"))
    images = json.loads((SRC / "data" / "images.json").read_text(encoding="utf-8"))
    cats = {c["slug"]: c for c in catalog["categories"]}
    products = catalog["products"]
    top = {p["slug"] for p in sorted(products, key=lambda p: -p["reviews"])[:8]}
    for p in products:
        p["url"] = f"/products/{p['slug']}/"
        p["category_name"] = cats[p["category"]]["name"]
        tags = set(p["tags"]) | set(p["badges"])
        if p["slug"] in top:
            tags.add("top")
        if p["price"] < 400:
            tags.add("under-400")
        p["filter_tags"] = " ".join(sorted(tags))
        p["need"] = p.get("photos", 0)  # photos needed for the pre-selected options
        for opt in p["options"]:
            opt["default"] = default_index(p, opt)
            p["need"] = opt["values"][opt["default"]].get("photos", p["need"])
        missing = [g for g in [p["slug"], *p["gallery"]] if g not in images]
        if missing:
            sys.exit(f"Missing images for {p['slug']}: {missing} - run tools/render_mockups.py / build_images.py")
    for c in catalog["categories"]:
        c["url"] = f"/collections/{c['slug']}/"
        c["products"] = [p for p in products if p["category"] == c["slug"]]
    for o in catalog["occasions"]:
        o["url"] = f"/gifts/{o['slug']}/"
        o["products"] = [p for p in products if OCCASION_TAG[o["slug"]] in p["tags"]]
    return catalog, images


# ---------------------------------------------------------------- structured data
def ld_org(site, asset):
    return {"@context": "https://schema.org", "@type": "OnlineStore", "@id": site["url"] + "/#org",
            "name": site["name"], "url": site["url"] + "/", "logo": site["url"] + "/icon-512.png",
            "image": site["url"] + asset("/assets/img/og-default.jpg"), "description": site["description"],
            "email": site["email"], "areaServed": "IN", "sameAs": list(site["social"].values())}


def ld_website(site):
    return {"@context": "https://schema.org", "@type": "WebSite", "@id": site["url"] + "/#website",
            "name": site["name"], "url": site["url"] + "/", "inLanguage": "en-IN", "publisher": {"@id": site["url"] + "/#org"}}


def ld_breadcrumbs(site, crumbs):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i, "name": name, "item": site["url"] + url} for i, (name, url) in enumerate(crumbs, 1)]}


def ld_faq(faqs):
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in faqs]}


def ld_itemlist(site, items):
    return {"@context": "https://schema.org", "@type": "ItemList", "itemListElement": [
        {"@type": "ListItem", "position": i, "url": site["url"] + p["url"], "name": p["name"]} for i, p in enumerate(items, 1)]}


def ld_product(site, p, images, asset):
    imgs = [site["url"] + asset(f"{images[g]['src']}-{images[g]['widths'][-1]}.webp") for g in p["gallery"]]
    # NOTE: add "aggregateRating"/"review" here only once you have genuine customer reviews.
    return {"@context": "https://schema.org", "@type": "Product", "name": p["name"], "sku": p["slug"], "image": imgs,
            "description": p["description"], "category": p["category_name"], "brand": {"@type": "Brand", "name": site["name"]},
            "offers": {"@type": "Offer", "url": site["url"] + p["url"], "priceCurrency": "INR", "price": str(p["price"]),
                       "availability": "https://schema.org/InStock", "itemCondition": "https://schema.org/NewCondition",
                       "seller": {"@id": site["url"] + "/#org"}}}


def emph(text):
    """Turn *word* into the brand's italic-serif accent (everything else stays escaped)."""
    return Markup(re.sub(r"\*(.+?)\*", lambda mt: f'<span class="serif accent">{mt.group(1)}</span>', str(escape(text))))


def clip(text, n=158):
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0].rstrip(",;-") + "…"


# ---------------------------------------------------------------- build
def build(inline_css=False):
    catalog, images = load_data()
    site = catalog["site"]
    # Empty dist/ rather than deleting it, so a running dev server or open Explorer window can't block the build.
    DIST.mkdir(exist_ok=True)
    for child in DIST.iterdir():
        shutil.rmtree(child) if child.is_dir() else child.unlink()
    asset = Assets()

    # Static files: /assets/** fingerprinted, everything else copied as-is.
    static = SRC / "static"
    for f in sorted(static.rglob("*")):
        if f.is_file():
            url = "/" + f.relative_to(static).as_posix()
            if url.startswith("/assets/"):
                asset.add(url, f.read_bytes())
            else:
                (DIST / url.lstrip("/")).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, DIST / url.lstrip("/"))

    css = (SRC / "css" / "main.css").read_text(encoding="utf-8")
    css = re.sub(r'url\("(/assets/[^"]+)"\)', lambda mt: f'url("{asset(mt.group(1))}")', css)
    css = minify_css(css)
    asset.add("/assets/css/main.css", css.encode())
    # Page-specific stylesheets: inlined (or linked) only where a page lists them in page["css"].
    page_css = {name: minify_css((SRC / "css" / f"{name}.css").read_text(encoding="utf-8")) for name in ("checkout", "admin")}
    for name, text in page_css.items():
        asset.add(f"/assets/css/{name}.css", text.encode())
    for name in SCRIPTS:
        asset.add(f"/assets/js/{name}.js", minify_js((SRC / "js" / f"{name}.js").read_text(encoding="utf-8")).encode())

    products = catalog["products"]
    search = [{"name": p["name"], "url": p["url"], "meta": p["meta"], "price": p["price"],
               "image": asset(f"{images[p['slug']]['src']}-120.webp" if 120 in images[p["slug"]]["widths"]
                              else f"{images[p['slug']]['src']}-{images[p['slug']]['widths'][0]}.webp"),
               "text": " ".join([p["name"], p["category_name"], p["meta"], p["short"], *p["tags"]]).lower()} for p in products]
    asset.add("/assets/search.json", json.dumps(search, separators=(",", ":"), ensure_ascii=False).encode())

    env = Environment(loader=FileSystemLoader(SRC / "templates"), autoescape=True, undefined=StrictUndefined,
                      trim_blocks=True, lstrip_blocks=True)
    cats_by_slug = {c["slug"]: c for c in catalog["categories"]}
    env.filters["emph"] = emph
    env.globals.update(
        site=site, images=images, asset=asset, year=dt.date.today().year,
        categories=catalog["categories"], categories_by_slug=cats_by_slug, occasions=catalog["occasions"],
        products=products, products_by_slug={p["slug"]: p for p in products},
        products_by_reviews=sorted(products, key=lambda p: -p["reviews"]),
        reviews=catalog["reviews"], faqs=catalog["faqs"],
        states=json.loads((SRC / "data" / "states.json").read_text(encoding="utf-8")),
        nav_groups=[{"title": t, "links": [cats_by_slug[s] for s in slugs]} for t, slugs in NAV_GROUPS],
        inline_css=css if inline_css else "", page_css=page_css if inline_css else {},
    )
    pages = []

    def render(template, path, page, **ctx):
        for key, default in (("jsonld", []), ("noindex", False), ("body_class", ""), ("og_type", "website"),
                             ("og_title", ""), ("og_image", ""), ("og_image_alt", ""), ("minimal", False), ("scripts", []),
                             ("css", [])):
            page.setdefault(key, default)
        page["path"] = path
        html = minify_html(env.get_template(template).render(page=page, **ctx))
        out = DIST / (path.strip("/") + "/index.html" if path != "/" else "index.html")
        if path.endswith(".html"):
            out = DIST / path.lstrip("/")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")
        if not page["noindex"] and not path.endswith(".html"):
            pages.append(path)

    org, web = ld_org(site, asset), ld_website(site)

    # Home
    render("pages/home.html", "/", {
        "title": "Personalised Photo Gifts & Polaroid Prints | KissaPrints",
        "description": "Turn your photos into personalised gifts: polaroid prints, photo strips, song plaques, star maps, magazines & hampers. Made in India, delivered fast.",
        "jsonld": [org, web, ld_faq(catalog["faqs"])],
    })

    chips_all = [("All gifts", "/shop/"), ("Bestsellers", "/collections/bestsellers/")] + [(c["name"], c["url"]) for c in catalog["categories"]]

    def collection(path, heading, intro, items, crumbs, title, seo_title, seo_paras, related, description=None):
        render("pages/collection.html", path, {
            "title": title, "description": clip(description or intro),
            "jsonld": [ld_breadcrumbs(site, crumbs), ld_itemlist(site, items)],
        }, heading=heading, intro=intro, items=items, crumbs=crumbs, chips=chips_all,
            seo_title=seo_title, seo_paras=seo_paras, related=related)

    shop_intro = "Polaroid-style prints, photo strips, song plaques, star maps, magazines, calendars, keychains and hampers - every one of them made with your photos."
    collection("/shop/", "All personalised gifts", shop_intro, products, [("Home", "/"), ("All gifts", "/shop/")],
               "Shop Personalised Photo Gifts Online in India | KissaPrints", "Personalised photo gifts for every occasion",
               ["KissaPrints makes personalised photo gifts in India, designed around the photos already on your phone. Choose a format, add your pictures and a few words, and we'll print, pack and deliver it across India.",
                "Looking for something specific? Shop gifts for couples, friends or parents, or explore our bestsellers for the keepsakes people order again and again."],
               catalog["categories"][:6])
    best = sorted(products, key=lambda p: -p["reviews"])[:8]
    collection("/collections/bestsellers/", "Bestsellers", "The keepsakes our customers order again and again - start here if you can't decide.",
               best, [("Home", "/"), ("Bestsellers", "/collections/bestsellers/")],
               "Bestselling Personalised Gifts | KissaPrints", "Our most-loved personalised gifts",
               ["From Classic Memoroids to song plaques and photo booth strips, these are the gifts that get the biggest reactions. Every one is printed on premium material and packed gift-ready."],
               catalog["categories"][:6])
    for i, c in enumerate(catalog["categories"]):
        related = [x for x in catalog["categories"] if x["slug"] != c["slug"]][i % 6: i % 6 + 6]
        collection(c["url"], c["name"], c["intro"], c["products"], [("Home", "/"), ("Shop", "/shop/"), (c["name"], c["url"])],
                   f"{c['seo']} | KissaPrints", c["seo"],
                   [c["intro"], f"Every {c['name'].lower()} order is checked by our team before printing, packed gift-ready and dispatched within {site['dispatch']}. Free shipping on orders above ₹{site['free_shipping_over']}."],
                   related)
    for o in catalog["occasions"]:
        collection(o["url"], f"Gifts {o['name'].lower()}", o["intro"], o["products"], [("Home", "/"), ("Gifts", "/shop/"), (o["name"], o["url"])],
                   f"{o['seo']} | KissaPrints", o["seo"],
                   [o["intro"], "Can't choose? Our Affection Box hamper bundles five personalised keepsakes, wrapped and ready to give."],
                   [x for x in catalog["categories"]][:6])

    # Products
    for i, p in enumerate(products):
        cat = cats_by_slug[p["category"]]
        crumbs = [("Home", "/"), (cat["name"], cat["url"]), (p["name"], p["url"])]
        same_cat = [x for x in products if x["category"] == p["category"] and x["slug"] != p["slug"]]
        others = [x for x in products if x["category"] != p["category"]]
        related = (same_cat + others[i % len(others):] + others)[:4]
        own = [r for r in catalog["reviews"] if r["product"] == p["slug"]]
        render("pages/product.html", p["url"], {
            "title": f"{p['name']} - Personalised {cat['name']} | KissaPrints" if len(p["name"]) < 26 else f"{p['name']} | KissaPrints",
            "description": clip(f"{p['short']} {p['meta']}. From ₹{p['price']:,}, delivered across India."),
            "og_type": "product", "og_image": asset(f"{images[p['slug']]['src']}-1200.webp"), "og_image_alt": p["name"],
            "jsonld": [ld_product(site, p, images, asset), ld_breadcrumbs(site, crumbs)],
        }, p=p, related=related, product_reviews=own + [r for r in catalog["reviews"] if r["product"] != p["slug"]])

    # Info pages
    for slug, (title, heading, intro, desc) in INFO_PAGES.items():
        crumb = title.split(" | ")[0].split(" - ")[0]
        jsonld = [ld_breadcrumbs(site, [("Home", "/"), (crumb, f"/{slug}/")])]
        if slug == "faq":
            jsonld.append(ld_faq(catalog["faqs"]))
        render("pages/info.html", f"/{slug}/", {"title": title, "description": desc, "jsonld": jsonld,
                                                 "noindex": slug == "thank-you",
                                                 "scripts": ["/assets/js/order.js"] if slug == "track-order" else [],
                                                 "css": ["checkout"] if slug == "track-order" else []},
               slug=slug, heading=heading, crumb=crumb, intro=intro)
    render("pages/404.html", "/404.html", {"title": "Page not found | KissaPrints",
                                            "description": "This page couldn't be found.", "noindex": True})

    # Ordering: checkout (no distractions), the customer's order page, and the team's dashboard.
    render("pages/checkout.html", "/checkout/", {"title": "Checkout | KissaPrints", "noindex": True, "minimal": True,
                                                 "description": "Secure checkout for your KissaPrints order.",
                                                 "scripts": ["/assets/js/checkout.js"], "css": ["checkout"]})
    render("pages/order.html", "/order/", {"title": "Your order | KissaPrints", "noindex": True, "css": ["checkout"],
                                           "description": "Your KissaPrints order status.", "scripts": ["/assets/js/order.js"]})
    render("pages/admin.html", "/admin/", {"title": "Orders | KissaPrints admin", "noindex": True, "description": ""})

    # SEO plumbing
    today = dt.date.today().isoformat()
    urls = "".join(f"<url><loc>{site['url']}{p}</loc><lastmod>{today}</lastmod></url>" for p in pages)
    (DIST / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n', encoding="utf-8")
    # /admin/ is deliberately not listed (robots.txt is public); it carries noindex instead.
    (DIST / "robots.txt").write_text("User-agent: *\nAllow: /\n" + "".join(f"Disallow: {p}\n" for p in ("/thank-you/", "/checkout/", "/order/", "/api/"))
                                     + f"\nSitemap: {site['url']}/sitemap.xml\n", encoding="utf-8")
    (DIST / "_headers").write_text(
        "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n"
        "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n"
        "  Permissions-Policy: camera=(), microphone=(), geolocation=()\n", encoding="utf-8")

    html_kb = sum(f.stat().st_size for f in DIST.rglob("*.html")) / 1024
    print(f"Built {len(pages)} indexable pages -> {DIST}  (html {html_kb:.0f} KB, css {len(css) / 1024:.1f} KB"
          f"{' inlined' if inline_css else ''})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--external-css", action="store_true", help="link main.css instead of inlining it")
    build(inline_css=not ap.parse_args().external_css)
