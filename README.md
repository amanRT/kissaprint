# KissaPrints website

Storefront design and front-end for **kissaprints.com**: personalised photo gifts (Memoroids, photo strips, song plaques, star maps, magazines, calendars, hampers). Every photo has a *kissa*, a story.

It's a static site generated from Jinja2 templates and one content file. CSS is hand-written and JavaScript is about 13 KB with no framework, so pages are fast and easy to host anywhere.

| Lighthouse 13 (9 key pages) | Mobile | Desktop |
|---|---|---|
| Performance | 95–100 | 100 |
| Accessibility | 100 | 100 |
| Best practices | 100 | 100 |
| SEO | 100 | 100 |

---

## Quick start

You need **Python 3.10+**. Node.js 20+ is optional and only used for Lighthouse audits.

**Windows (PowerShell)**
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
python tools/build.py
python tools/serve.py --watch     # http://localhost:8080, rebuilds when src/ changes
```

**macOS / Linux**
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python tools/build.py
python tools/serve.py --watch
```

`requirements.txt` holds only what the build needs (Jinja2). `requirements-dev.txt` adds the image, font and QA tools.

---

## Project layout

```
src/
  data/catalog.json      All content: site settings, products, categories, occasions, reviews, FAQs
  data/images.json       Generated image manifest (sizes per image). Don't edit by hand.
  templates/
    base.html            <head> (SEO tags, fonts, JSON-LD), header, footer, dialogs
    macros.html          picture(), product_card(), price(), stars(), breadcrumbs()...
    partials/            header (mega-menus), footer, dialogs (search, cart, mobile menu), icon sprite
    pages/               home, collection (shop/category/occasion), product, info, 404
    content/             Body copy of the info pages (about, contact, policies...)
  css/main.css           Design tokens at the top, then components, sections, pages
  js/main.js             Cart, search, menus, tabs, product options, live Memoroid maker
  static/                Copied into dist/. Everything under assets/ gets a content hash.
tools/                   Build, dev server, asset pipeline, QA (each script has usage notes at the top)
design/
  mockups/               "Photo studio": HTML/CSS scenes rendered into product images
  photos.json            Placeholder photo list (Pexels IDs). Originals download to source-photos/
  source-fonts/          Full font files + OFL licences
dist/                    Build output (git-ignored). This is what you deploy.
```

## How the pages are made

`tools/build.py` reads `catalog.json` and renders:

- `/` home
- `/shop/` and `/collections/bestsellers/`
- `/collections/<category>/` for every category
- `/gifts/<occasion>/` for every occasion
- `/products/<slug>/` for every product
- info pages: `/about/`, `/contact/`, `/faq/`, `/bulk-orders/`, `/shipping/`, `/returns/`, `/privacy/`, `/terms/` and `/track-order/`, plus `/404.html`

It also writes `sitemap.xml`, `robots.txt`, `_headers` (cache rules) and a search index. All CSS and JS is minified, and every asset filename gets a content hash.

CSS is **inlined** into each page by default, which gives the fastest first visit. Use `python tools/build.py --external-css` to switch to one cached stylesheet instead.

### Common tasks

- **Edit prices, copy or FAQs:** change `src/data/catalog.json` and rebuild.
- **Add a product:**
  1. Add an entry under `products` in `catalog.json`.
  2. Add a product image (see below), using the product slug as the image name.
  3. Rebuild. The product page, category listing, search and sitemap update automatically.
- **Change colours or type:** edit the tokens at the top of `src/css/main.css`.
- **Edit an info page:** change `src/templates/content/<page>.html`. Titles and meta descriptions live in `INFO_PAGES` in `tools/build.py`.

---

## Images and fonts

| What | How |
|---|---|
| Product images | Edit a scene in `design/mockups/studio.html` / `studio.css`. Preview all scenes with `python tools/serve.py --root design --port 8090` at `/mockups/studio.html?grid`. Render with `python tools/render_mockups.py [scene-id ...]`. |
| Lifestyle photos | Add to `design/photos.json` → `python tools/fetch_photos.py` → add a crop in `tools/build_images.py` → `python tools/build_images.py` |
| Real product photos | Swap any file in `src/static/assets/img/` using the same name and sizes, or extend `build_images.py` to encode your shots |
| Fonts | `python tools/build_fonts.py` subsets Bricolage Grotesque, Instrument Serif and Caveat to about 100 KB of WOFF2 |
| Share image and icons | Scenes `og` and `icon` in the studio: `python tools/render_mockups.py og icon` |

Every image is encoded as AVIF + WebP at several widths and served with `srcset` and real width/height, so there's no layout shift.

---

## QA: screenshots and audits

```bash
python tools/shoot.py                  # scroll-through screenshots, desktop + mobile, into qa/screens/
python tools/shoot.py --interactions   # mega-menu, search, cart drawer, maker, mobile menu
npm install                            # once: installs Lighthouse into node_modules/
python tools/lighthouse.py             # scores and failing audits for key pages, reports in qa/lighthouse/
```

`shoot.py` also flags console errors, horizontal overflow, broken images and missing alt text. It exits non-zero if anything is wrong.

### Why it's fast

- Self-hosted, subset fonts with metric-matched fallbacks, so text doesn't jump when fonts load.
- Responsive AVIF/WebP images, lazy-loaded below the fold; the main image gets `fetchpriority="high"`.
- Inline CSS and one deferred 13 KB script, with no third-party requests.
- `content-visibility: auto` on below-the-fold sections, and menu images load only when a menu opens.
- No layout reads at startup (an IntersectionObserver drives the sticky header), and animations stay on the compositor.

### SEO built in

- A unique title and description on every page, plus canonical URLs, Open Graph and Twitter cards.
- JSON-LD structured data: `OnlineStore`, `WebSite`, `Product` + `Offer`, `BreadcrumbList`, `ItemList` and `FAQPage`.
- `sitemap.xml` and `robots.txt`, semantic headings, descriptive link text and alt text.
- A "popular searches" internal-link block in the footer.

---

## Deploying

### Vercel (set up: auto-deploys on every push)

`vercel.json` configures everything:

- **Framework preset: Other.** This is a static site that Python *builds*. Without this, Vercel sees `requirements.txt` and mistakes the project for a Python API.
- **Build:** `sh tools/vercel-build.sh` creates a temporary virtualenv, installs Jinja2 and runs `tools/build.py`. Vercel serves the `dist/` folder.
- **No `npm install`:** Node is only used for local Lighthouse audits.
- **URLs and caching:** `trailingSlash: true` matches the canonical URLs, and hashed `/assets/*` files are cached for a year.

How it behaves:

- A push to `main` deploys **production**.
- Any other branch or pull request gets its own **preview URL**, which Vercel posts on the PR. Test changes there before merging.
- Preview URLs require a Vercel login by default. To show a preview to someone, use **Share** on the deployment (a shareable link), or change **Settings → Deployment Protection**.
- If a deploy still says "No python entrypoint found", set **Settings → Build & Deployment → Framework Preset** to **Other**.

> Vercel's free **Hobby plan is for non-commercial use only**. A live business site needs **Pro** (viewer seats are free).
> **Cloudflare Pages** and **Netlify** free tiers allow commercial use and also auto-deploy from GitHub. Use build command `pip install -r requirements.txt && python tools/build.py` and output directory `dist`; the generated `_headers` file handles caching there.

---

## Before launch: placeholders to replace

- [ ] **Photos:** placeholder images come from Pexels (free licence, see `design/source-photos/CREDITS.md`). Replace them with real product photography.
- [ ] **Social proof:** ratings, review counts, the reviews themselves and "10,000+ gifters" are **placeholders**. Publish only genuine reviews; Indian consumer-protection rules prohibit fake ones. Add `aggregateRating` to the Product JSON-LD in `tools/build.py` only when the reviews are real.
- [ ] **Contact details:** WhatsApp number, registered business address and GST details (`site` in `catalog.json`, contact page).
- [ ] **Policies:** privacy, terms, shipping and returns are drafts. Get a legal review, including against the DPDP Act 2023.
- [ ] **Commerce:** the cart is front-end only (localStorage). Checkout, payments (Razorpay, Cashfree...), photo upload storage and order emails need a backend, or move to Shopify; these templates map cleanly onto Shopify sections.
- [ ] **Forms:** newsletter, contact and bulk-order forms show a success message but don't send anything yet. Connect them to an email or form service.
- [ ] **Social handles, Search Console:** confirm the handles in `catalog.json`, verify Google Search Console and submit `sitemap.xml`.
- [ ] **Brand checks:** confirm the KissaPrints trademark. The song plaque copy deliberately says "song code" rather than using a streaming brand's name.

## Credits

Fonts: Bricolage Grotesque, Instrument Serif, Caveat and UnifrakturMaguntia (mockups only), all under the SIL Open Font License. Placeholder photos: Pexels, under the Pexels License.
