# KissaPrints website

Storefront design and front-end for **kissaprints.com**: personalised photo gifts (Memoroids, photo strips, song plaques, star maps, magazines, calendars, hampers). Every photo has a *kissa*, a story.

It's a static site generated from Jinja2 templates and one content file. CSS is hand-written and JavaScript has no framework, so pages are fast. Checkout, Razorpay payments, photo uploads and the team's order dashboard run on a small Python backend (standard library only) that deploys as one Vercel Function.

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
The order dashboard is at http://localhost:8080/admin/ (local password: `admin`). Without any settings, checkout uses a fake payment window and keeps orders and photos in `.data/`. See [Orders, payments and the admin](#orders-payments-and-the-admin).

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
backend/                 Order API: pricing, Razorpay, Supabase/local storage, admin (stdlib only) + schema.sql
api/index.py             Vercel Function entry point; vercel.json sends every /api/* request here
tests/                   Backend unit tests (python -m unittest discover tests)
src/
  data/catalog.json      All content: site settings, products, categories, occasions, reviews, FAQs
  data/states.json       Indian states and UTs for the checkout form (also used to validate it)
  data/images.json       Generated image manifest (sizes per image). Don't edit by hand.
  templates/
    base.html            <head> (SEO tags, fonts, JSON-LD), header, footer, dialogs
    macros.html          picture(), product_card(), price(), stars(), breadcrumbs()...
    partials/            header (mega-menus), footer, dialogs (search, cart, mobile menu), icon sprite
    pages/               home, collection (shop/category/occasion), product, info, 404
    content/             Body copy of the info pages (about, contact, policies...)
  css/main.css           Design tokens at the top, then components, sections, pages (inlined on every page)
  css/checkout.css       Checkout, order and track-order pages only; css/admin.css for /admin/
  js/main.js             Cart, search, menus, tabs, product options + photo uploads, live Memoroid maker
  js/checkout.js         Checkout + Razorpay; js/order.js order page + tracking; js/admin.js dashboard
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
- ordering: `/checkout/`, `/order/` (the customer's order page) and `/admin/` (the team's dashboard), all `noindex`

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
- **Shipping:** `site.free_shipping_over` and `site.shipping_fee` in `catalog.json`. The server uses the same numbers.
- **Photos needed:** `"photos"` on a product, or on an option value when it depends on the choice (`{ "label": "30 prints", "price": 599, "photos": 30 }`).

---

## Orders, payments and the admin

1. **Product page:** photos upload the moment the shopper picks them, straight to storage through one-time signed links (up to 25 MB each). Each cart line keeps its options, caption and photos.
2. **Checkout `/checkout/`:** contact and delivery address. The server re-prices the cart from `catalog.json`, so prices in the browser are never trusted. It then adds shipping and opens a Razorpay order for that exact amount.
3. **Payment:** Razorpay Checkout (UPI, cards, net banking, wallets).
   - The server checks Razorpay's signature before marking the order paid.
   - The webhook confirms the payment too, even if the shopper closes the tab.
4. **Order page `/order/?id=…&t=…`:** confirmation, a status timeline, a reminder if photos are missing, and courier tracking once shipped. `/track-order/` finds it again from the order number plus email or phone.
5. **Admin `/admin/`:** sign in with the team password. Tabs are New (paid, to print), Printing, Shipped, Delivered, Unpaid and Cancelled. No refreshing needed: the dashboard checks every 30 seconds and a new paid order pops up with a chime (sound starts after your first click on the page). Orders paid with the test payment window or Razorpay test keys are labelled **Test** and can be deleted; real orders can't. Open an order to:
   - see the customer and address (copy button) and the items with options and captions
   - download all of its photos as one .zip
   - check the payment, then set the status, courier and tracking link (the customer sees these)

| | Orders and photos | Payments |
|---|---|---|
| Local, no settings | `.data/` folder (git-ignored) | Fake payment window; nothing is charged |
| With settings (local `.env` or Vercel) | Supabase: Postgres table + private Storage bucket | Razorpay, test or live keys |

On Vercel a missing setting switches that feature off with a clear message, for example "payments are being set up". It never falls back to the fake payment.

### Set it up on Vercel (about 20 minutes)

1. **Supabase** (free plan to start):
   - Create a project.
   - In **SQL Editor**, paste `backend/schema.sql` and run it. This creates the `orders` table and the private `order-photos` bucket.
   - From **Project Settings → API Keys**, copy the project URL and a **secret** key (`sb_secret_…`, or the legacy `service_role` key).
2. **Razorpay:**
   - Sign up and switch to **Test mode**.
   - Under **Account & Settings → API Keys**, generate a key pair.
   - Under **Webhooks**, add `https://<your-site>/api/razorpay-webhook/` (keep the trailing slash). Choose a secret and the events `payment.captured`, `order.paid` and `payment.failed`.
3. **Vercel → Project → Settings → Environment Variables:** add the names listed in `.env.example`: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `ADMIN_PASSWORD` (long and random). Optionally add `TEST_PHONES`, the team's mobile numbers whose orders skip payment for testing. Then redeploy.
4. **Check the settings:** `https://<your-site>/api/health/` should show `"payments":"razorpay","storage":"supabase"`. The admin header shows "Razorpay test mode" until you switch to live keys.
5. **Test it:** place an order using Razorpay's test payment details, then find it in `/admin/`.

**Going live:**
- Complete Razorpay's KYC. It checks that the site has About, Contact, Terms, Privacy and Refund pages; drafts are in `src/templates/content/`.
- Generate live keys and add a live-mode webhook, then replace the three Razorpay variables.
- Move to Vercel Pro (see below).

### Run and test it locally

```bash
python tools/serve.py                # checkout + /admin/ on http://localhost:8080 (restart after backend/ changes)
python -m unittest discover tests    # pricing, validation, signatures, webhooks, admin, Supabase requests
python tools/checkout_test.py        # whole purchase in headless Chrome: product -> pay -> admin -> tracking
python tools/checkout_test.py --supabase   # the same against the Supabase project in .env (leaves a "Test" order)
```

To try real Razorpay test payments or Supabase locally, copy `.env.example` to `.env` and fill it in.

### How it's protected

- **Prices and payment:**
  - Totals and the Razorpay amount come from the server.
  - Payment and webhook signatures are checked with HMAC-SHA256.
  - Each order is marked paid at most once, even if the browser and the webhook both report the payment.
- **Photos:** kept in a private bucket. The admin sees them through links that expire after an hour. Uploads accept only photo file types.
- **Order links:** each customer link carries an unguessable token; track-order also needs the matching email or phone.
- **Team test numbers (`TEST_PHONES`):** orders placed with these numbers skip payment, so the numbers live only in env vars, never in the public code. Those orders are always labelled **Test** ("don't print or ship it") and can be deleted. Remove the setting when you no longer need it.
- **Admin:**
  - Sign-in sets an HttpOnly, SameSite=Strict cookie that lasts 12 hours. Changing `ADMIN_PASSWORD` signs everyone out.
  - The admin API accepts JSON only.
  - The page is `noindex`, can't be framed and has a strict Content Security Policy.

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

`shoot.py` also flags console errors, horizontal overflow, broken images and missing alt text. It exits non-zero if anything is wrong. For the ordering flow, run `python tools/checkout_test.py --shots`; screenshots go to `qa/checkout/`.

### Why it's fast

- Self-hosted, subset fonts with metric-matched fallbacks, so text doesn't jump when fonts load.
- Responsive AVIF/WebP images, lazy-loaded below the fold; the main image gets `fetchpriority="high"`.
- Inline CSS and one deferred script, with no third-party requests. Checkout styles and scripts load only on checkout pages, and Razorpay's script loads only once a shopper starts filling in the checkout form.
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
- **API:** `api/index.py` becomes one Python Vercel Function, and the rewrite in `vercel.json` sends every `/api/*` request to it. Settings come from the project's environment variables (see above).
- **No `npm install`:** Node is only used for local Lighthouse audits.
- **URLs and caching:** `trailingSlash: true` matches the canonical URLs, and hashed `/assets/*` files are cached for a year.

How it behaves:

- A push to `main` deploys **production**.
- Any other branch or pull request gets its own **preview URL**, which Vercel posts on the PR. Test changes there before merging.
- Preview URLs require a Vercel login by default. To show a preview to someone, use **Share** on the deployment (a shareable link), or change **Settings → Deployment Protection**.
- If a deploy still says "No python entrypoint found", set **Settings → Build & Deployment → Framework Preset** to **Other**.

> Vercel's free **Hobby plan is for non-commercial use only**. A live business site needs **Pro** (viewer seats are free).
> **Cloudflare Pages** and **Netlify** can host the static pages (build command `pip install -r requirements.txt && python tools/build.py`, output directory `dist`; the generated `_headers` file handles caching). They can't run the Python order API, so checkout and the admin need Vercel or another Python host.

---

## Before launch: placeholders to replace

- [ ] **Photos:** placeholder images come from Pexels (free licence, see `design/source-photos/CREDITS.md`). Replace them with real product photography.
- [ ] **Social proof:** ratings, review counts, the reviews themselves and "10,000+ gifters" are **placeholders**. Publish only genuine reviews; Indian consumer-protection rules prohibit fake ones. Add `aggregateRating` to the Product JSON-LD in `tools/build.py` only when the reviews are real.
- [ ] **Contact details:** WhatsApp number, registered business address and GST details (`site` in `catalog.json`, contact page).
- [ ] **Policies:** privacy, terms, shipping and returns are drafts. Get a legal review, including against the DPDP Act 2023.
- [ ] **Payments:** connect Supabase and Razorpay (see [Set it up on Vercel](#set-it-up-on-vercel-about-20-minutes)), test with test keys, then complete Razorpay KYC and switch to live keys.
- [ ] **Shipping fee:** `site.shipping_fee` (₹79) is a placeholder; set your real fee.
- [ ] **Order emails / WhatsApp updates:** not built yet. Customers get the order page link on screen only, so this is the next thing to add (for example Resend for email, or a WhatsApp Business API provider).
- [ ] **Customer photos:** decide how long to keep them after delivery (DPDP Act) and say so in the privacy policy. Deleting old photos is manual in Supabase Storage for now.
- [ ] **Not built yet:** cash on delivery, coupon codes (the newsletter currently promises a ₹100 code), courier booking (Shiprocket) and GST invoices.
- [ ] **Forms:** newsletter, contact and bulk-order forms show a success message but don't send anything yet. Connect them to an email or form service.
- [ ] **Social handles, Search Console:** confirm the handles in `catalog.json`, verify Google Search Console and submit `sitemap.xml`.
- [ ] **Brand checks:** confirm the KissaPrints trademark. The song plaque copy deliberately says "song code" rather than using a streaming brand's name.

## Credits

Fonts: Bricolage Grotesque, Instrument Serif, Caveat and UnifrakturMaguntia (mockups only), all under the SIL Open Font License. Placeholder photos: Pexels, under the Pexels License.
