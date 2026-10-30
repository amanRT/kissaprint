# KissaPrints website

Storefront for **kissaprints.com**: personalised photo gifts (Memoroids, photo strips, song plaques, star maps, magazines, calendars, hampers). Every photo has a *kissa*, a story.

It's a **Next.js 16** app (App Router, React 19, TypeScript). Every catalog page is pre-rendered to static HTML from one content file, and most of the UI is server components, so little JavaScript ships. Checkout, Razorpay payments, photo uploads, customer accounts and the team's order dashboard run as Next.js route handlers on Vercel, with Supabase for storage. The admin is protected by JWT sessions.

| Lighthouse 13 (key pages) | Mobile | Desktop |
|---|---|---|
| Performance | 90–100 | 99–100 |
| Accessibility | 100 | 100 |
| Best practices | 100 | 100 |
| SEO | 100 | 100 |

Mobile performance is 100 on pages whose largest element is text (home, shop). Pages led by a big image (product, collection, about) score 90–94 in local runs; see [Why it's fast](#why-its-fast). Log-in, account, checkout and order pages are `noindex` on purpose, which Lighthouse's SEO check flags.

---

## Quick start

You need **Node.js 20.9+**. Python 3.10+ is only needed for the image/font tools and the QA scripts.

```bash
npm install
npm run dev          # http://localhost:3000
```

Without any settings, checkout uses a fake payment window, and orders, photos and accounts are kept in `.data/` (git-ignored). To open the order dashboard, create an admin account and log in at http://localhost:3000/login/:

```bash
npm run create-admin -- --email you@example.com --name "Your Name"    # asks for a password
```

Production build: `npm run build && npm start`. For the Python tools: `python -m venv .venv`, activate it, then `pip install -r requirements-dev.txt`.

---

## Project layout

```
src/
  app/                     Routes (App Router)
    (shop)/                Pages with the shop header and footer: home, shop, collections, gifts, products,
                           info pages ([page]), track-order, login, signup, account, order
    (checkout)/checkout/   Checkout, with the minimal header
    admin/                 Order dashboard and products/ (what's on the website); admins only
    api/                   Route handlers: quote, uploads, orders, verify, razorpay-webhook, order, track,
                           health, auth/* (signup, login, logout, me), admin/* (orders, order, changes, delete, photo)
    layout.tsx             <html>, fonts, default metadata
    not-found.tsx          The 404 page; sitemap.ts and robots.ts
  proxy.ts                 Route protection: checks the JWT before /admin, /api/admin, /account and /checkout render
  components/              Server components plus small client islands (shop/, product/, checkout/, admin/, auth/...)
  lib/                     catalog.ts (typed content), assets.ts (image URLs), seo.ts (metadata + JSON-LD), format.ts
  lib/server/              config, pricing, orders, payments (Razorpay), store (Supabase or local), session (JWT),
                           passwords (scrypt), http (request context, auth checks)
  data/catalog.json        All content: site settings, products, categories, occasions, reviews, FAQs
  data/states.json         Indian states and UTs for the checkout form (also used to validate it)
  data/images.json         Generated image manifest (sizes per image). Don't edit by hand.
  styles/                  main.css (design tokens, then components, sections, pages), checkout.css, admin.css
  fonts/                   Subset WOFF2 files, loaded with next/font/local
public/                    Favicons, web manifest, assets/img/** (AVIF + WebP at several widths)
scripts/                   prepare-assets.mjs (runs before dev/build: image versions + search index), create-admin.ts
supabase/schema.sql        Tables (users, orders) and the private photo bucket. Safe to run again.
tests/                     Vitest unit tests
tools/                     Python: image and font pipeline, screenshots, Lighthouse, end-to-end test (usage notes at the top of each)
design/                    "Photo studio" mockups that render the product images, source photos and fonts
```

## How the pages are made

Pages are pre-rendered at build time (`generateStaticParams`, unknown slugs are a 404). The URLs:

- `/` home, `/shop/` and `/collections/bestsellers/`
- `/collections/<category>/` for every category and `/gifts/<occasion>/` for every occasion
- `/products/<slug>/` for every product
- info pages: `/about/`, `/contact/`, `/faq/`, `/bulk-orders/`, `/shipping/`, `/returns/`, `/privacy/`, `/terms/`, `/track-order/`
- ordering and accounts: `/checkout/`, `/order/`, `/login/`, `/signup/`, `/account/` and `/admin/`, all `noindex`

`/account/` and `/admin/` render per request because they read the session cookie. `sitemap.xml`, `robots.txt` and the search index are generated too. `scripts/prepare-assets.mjs` gives every image URL a `?v=<content hash>`, so `/assets/*` can be cached for a year.

### Common tasks

- **Edit prices, copy or FAQs:** change `src/data/catalog.json`.
- **Add a product:**
  1. Add an entry under `products` in `catalog.json`.
  2. Add a product image (see below), using the product slug as the image name.
  3. The product page, category listing, search and sitemap update automatically.
- **Change colours or type:** edit the tokens at the top of `src/styles/main.css`.
- **Edit an info page:** `INFO_PAGES` in `src/components/content/pages.tsx` holds the title, meta description and body of each one. Track-order has its own route, `src/app/(shop)/track-order/page.tsx`.
- **Shipping:** `site.free_shipping_over` and `site.shipping_fee` in `catalog.json`. The server uses the same numbers.
- **Photos needed:** `"photos"` on a product, or on an option value when it depends on the choice (`{ "label": "30 prints", "price": 599, "photos": 30 }`).

---

## Accounts and admin access

Anyone can browse, fill a cart and upload photos, but **ordering needs an account**, like Amazon: `/checkout/` sends signed-out shoppers to log in or sign up, then straight back with their cart intact (the cart lives in the browser), and the orders API refuses anyone not signed in. Customers get their details pre-filled at checkout and see all their orders at `/account/`. Orders placed before this change (guest orders) can still be found with `/track-order/`.

**Sessions** are a JWT (HS256, signed with `JWT_SECRET`) in an HttpOnly cookie, `kp_session`: SameSite=Lax, Secure on HTTPS, valid for 7 days. The token holds:

| Claim | Meaning |
|---|---|
| `sub` | user ID (`users.id`) |
| `isAdmin` | the user's `users.is_admin` at log-in |
| `email`, `name` | for display |
| `tv` | the user's `token_version`, so sessions can be revoked |
| `iss`, `aud`, `iat`, `exp` | issuer, audience, issued-at and expiry, all checked |

**On every request:**

1. `src/proxy.ts` verifies the token for `/admin/*`, `/api/admin/*`, `/account/*`, `/checkout/*` and `/api/orders/*`.
   - No valid token: pages redirect to `/login/?next=…`, APIs answer 401.
   - A valid token without `isAdmin`: `/admin/` redirects to `/account/?denied=1`, admin APIs answer 403.
2. The `/admin/` page and every admin API then re-check the database: the user must still exist, `is_admin` must still be true and `token_version` must match. Demoting an admin or "log out everywhere" therefore takes effect immediately, even for tokens that haven't expired.

**Admins:** sign-up always creates a customer (`is_admin = false`). To make an admin:

- run `npm run create-admin -- --email … --name "…"` (it uses `.env`, so it writes to Supabase when that's configured), or
- sign up on the site, then in Supabase's SQL Editor run `update public.users set is_admin = true where email = '…';` and log out and back in.

Passwords are hashed with scrypt and a per-user salt. Log-in errors don't reveal whether an email has an account. Changing `JWT_SECRET` signs everyone out.

### Showing and hiding products

`/admin/products/` lists every product with an **On website** switch. Switch one off when it runs out of stock:

- It disappears from every listing, the home page, the menus, search, related products and the sitemap. Home sections built around that one product hide too.
- A category or occasion with nothing left on the website disappears in the same way: no tile, menu item, chip or footer link leads to an empty page. The products page warns you when a product is the last one showing in a category.
- Its own page stays, so shared links still work, but it says "Currently unavailable" with no add-to-cart and asks search engines not to index it.
- The server refuses to price, upload photos for or order it, so a cart that still has it can't check out. Orders already placed aren't affected.

Switch it on again and it all comes back. The choice is stored in Supabase (`product_settings`) or `.data/products.json` locally. Pages stay static: switching expires their cache, and each page re-renders on its next visit.

---

## Orders, payments and the admin

1. **Product page:** photos upload the moment the shopper picks them, straight to storage through one-time signed links (up to 25 MB each). Each cart line keeps its options, caption and photos.
2. **Checkout `/checkout/`:** contact and delivery address. The server re-prices the cart from `catalog.json`, so prices in the browser are never trusted. It then adds shipping and opens a Razorpay order for that exact amount. Every order is linked to the shopper's account.
3. **Payment:** Razorpay Checkout (UPI, cards, net banking, wallets).
   - The server checks Razorpay's signature before marking the order paid.
   - The webhook confirms the payment too, even if the shopper closes the tab.
4. **Order page `/order/?id=…&t=…`:** confirmation, a status timeline, a reminder if photos are missing, and courier tracking once shipped. `/track-order/` finds it again from the order number plus email or phone.
5. **Admin `/admin/`:** log in with an admin account. Tabs are New (paid, to print), Printing, Shipped, Delivered, Unpaid and Cancelled. No refreshing needed: the dashboard checks every 30 seconds and a new paid order pops up with a chime (sound starts after your first click on the page). Orders paid with the test payment window, Razorpay test keys or a team test account are labelled **Test** and can be deleted; real orders can't. Open an order to:
   - see the customer and address (copy button) and the items with options and captions
   - download all of its photos as one .zip
   - check the payment, then set the status, courier and tracking link (the customer sees these)

| | Orders, photos and accounts | Payments |
|---|---|---|
| Local, no settings | `.data/` folder (git-ignored) | Fake payment window; nothing is charged |
| With settings (local `.env` or Vercel) | Supabase: Postgres tables + private Storage bucket | Razorpay, test or live keys |

On Vercel a missing setting switches that feature off with a clear message, for example "payments are being set up". It never falls back to the fake payment.

### Set it up on Vercel (about 20 minutes)

1. **Supabase** (free plan to start):
   - Create a project.
   - In **SQL Editor**, paste `supabase/schema.sql` and run it. This creates the `users`, `orders` and `product_settings` tables and the private `order-photos` bucket. It's safe to run again, and you need to after updates (this version adds `users`, `orders.user_id` and `product_settings`). Deploys read `product_settings` while building, so run it before deploying.
   - From **Project Settings → API Keys**, copy the project URL and a **secret** key (`sb_secret_…`, or the legacy `service_role` key).
2. **Razorpay:**
   - Sign up and switch to **Test mode**.
   - Under **Account & Settings → API Keys**, generate a key pair.
   - Under **Webhooks**, add `https://<your-site>/api/razorpay-webhook/` (keep the trailing slash). Choose a secret and the events `payment.captured`, `order.paid` and `payment.failed`.
3. **Vercel → Project → Settings → Environment Variables:** add the names listed in `.env.example`:
   - `JWT_SECRET`: required, 32+ random characters. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
   - `ADMIN_PASSWORD` and `TEST_PHONES` from the earlier version are no longer used and can be deleted.

   Then redeploy.
4. **Create the first admin** (see [Accounts and admin access](#accounts-and-admin-access)).
5. **Check the settings:** `https://<your-site>/api/health/` should show `"payments":"razorpay","storage":"supabase","auth":true`. The admin header shows "Razorpay test mode" until you switch to live keys.
6. **Test it:** place an order using Razorpay's test payment details, then find it in `/admin/`.

**Going live:**
- Complete Razorpay's KYC. It checks that the site has About, Contact, Terms, Privacy and Refund pages; drafts are in `src/components/content/pages.tsx`.
- Generate live keys and add a live-mode webhook, then replace the three Razorpay variables.
- Move to Vercel Pro (see below).

### Run and test it locally

```bash
npm run dev                          # http://localhost:3000 (checkout, accounts and /admin/ included)
npm test                             # Vitest: JWT sessions, proxy, accounts, pricing, orders, webhooks, Supabase requests
npm run typecheck
npm run build                        # needed before the Python QA scripts, which run `next start`
python tools/checkout_test.py        # whole journey in headless Chrome: sign-up, admin guard, product -> pay -> admin -> tracking
python tools/checkout_test.py --supabase   # the same against the Supabase project in .env (leaves a "Test" order and two e2e-… accounts)
```

To try real Razorpay test payments or Supabase locally, copy `.env.example` to `.env` and fill it in. Without `JWT_SECRET`, local runs use a random secret kept in `.data/jwt-secret`.

### How it's protected

- **Prices and payment:**
  - Totals and the Razorpay amount come from the server.
  - Payment and webhook signatures are checked with HMAC-SHA256.
  - Each order is marked paid at most once, even if the browser and the webhook both report the payment.
- **Photos:** kept in a private bucket. The admin sees them through links that expire after an hour. Uploads accept only photo file types.
- **Order links:** each customer link carries an unguessable token; track-order also needs the matching email or phone.
- **Team test accounts (`users.is_tester`):** orders placed while logged in to one of these accounts (the co-founders) skip payment, are always labelled **Test** ("don't print or ship it") and can be deleted. Every other account's orders are real. It's the account that counts, never a phone number typed at checkout, since anyone can type a number (the team's numbers are public as support numbers). Set it with `npm run create-admin -- … --tester` or `update public.users set is_tester = true where email = '…';`.
- **Admin:**
  - JWT session checked by `proxy.ts`, then the admin flag and token version re-checked in the database on every admin request (see above).
  - The APIs accept JSON only.
  - Admin pages are `noindex`, never cached and can't be framed.

---

## Images and fonts

| What | How |
|---|---|
| Product images | Edit a scene in `design/mockups/studio.html` / `studio.css`. Preview all scenes with `python tools/serve.py` at http://localhost:8090/mockups/studio.html?grid. Render with `python tools/render_mockups.py [scene-id ...]`. |
| Lifestyle photos | Add to `design/photos.json` → `python tools/fetch_photos.py` → add a crop in `tools/build_images.py` → `python tools/build_images.py [name ...]` |
| Real product photos | Swap any file in `public/assets/img/` using the same name and sizes, or extend `build_images.py` to encode your shots |
| Fonts | `python tools/build_fonts.py` subsets Bricolage Grotesque, Instrument Serif and Caveat into `src/fonts/` |
| Share image and icons | Scenes `og` and `icon` in the studio: `python tools/render_mockups.py og icon` |

Every image is encoded as AVIF + WebP at several widths and served with `srcset` and real width/height, so there's no layout shift. Photos that also appear as small thumbnails get an extra 160w size: `<Img>` (thumbnails) offers only the widths it needs, and `<Picture>` skips widths under 200 (`src/components/ui.tsx`).

---

## QA: screenshots and audits

All three run against the production build, so run `npm run build` first.

```bash
python tools/shoot.py                  # scroll-through screenshots, desktop + mobile, into qa/screens/
python tools/shoot.py --interactions   # mega-menu, search, cart drawer, maker, mobile menu
npm run audit                          # Lighthouse scores and failing audits for key pages, reports in qa/lighthouse/
```

`shoot.py` also flags console errors, horizontal overflow, broken images and missing alt text. It exits non-zero if anything is wrong. For the ordering flow, run `python tools/checkout_test.py --shots`; screenshots go to `qa/checkout/`.

### Why it's fast

- Catalog pages are static HTML, served from Vercel's CDN.
- Server components render the header, footer, cards and content. Only small islands ship JavaScript (cart, dialogs, product form, gallery, checkout, admin), so the JS is mostly React and Next.js themselves (about 145 KB gzip).
- One shared, cacheable stylesheet (13 KB gzip). Checkout styles load only on checkout, log-in, order and track-order pages, and Razorpay's script loads only once a shopper starts filling in the checkout form.
  - Inlining CSS (`experimental.inlineCss`) was measured and was slower: Next.js put the CSS in the HTML and twice more in the page's RSC payload.
- The RSC payload is kept small. Srcsets list only useful widths, since every candidate is repeated in the payload. The root 404 page is light, because Next.js embeds it in every page's payload.
- The main image is preloaded with `fetchpriority="high"`; everything below the fold is lazy-loaded.
- Self-hosted, subset fonts through `next/font/local`: preloaded, with size-adjusted fallbacks, so text doesn't jump when fonts load.
- `content-visibility: auto` on below-the-fold sections, and menu images load only when a menu opens.

**About the mobile scores on image-led pages:** Next.js loads its framework scripts as `async` scripts. Lighthouse's mobile simulation counts them as blocking a large *image* (not text) when they happen to finish before the first frame is shown. That puts product, collection and about pages around 90–94, and the result varies between machines. Desktop is 99–100 on every page.

### SEO built in

- A unique title and description on every page, plus canonical URLs, Open Graph and Twitter cards (the Next.js Metadata API, `src/lib/seo.ts`).
- JSON-LD structured data: `OnlineStore`, `WebSite`, `Product` + `Offer`, `BreadcrumbList`, `ItemList` and `FAQPage`.
- `sitemap.xml` and `robots.txt`, semantic headings, descriptive link text and alt text. Unknown URLs return a real 404.
- A "popular searches" internal-link block in the footer.

---

## Deploying

### Vercel (set up: auto-deploys on every push)

- **Framework preset: Next.js** (set in `vercel.json`). Vercel runs `npm run build`; the static pages go to the CDN, and the route handlers and `proxy.ts` run as Vercel Functions.
- **Settings** come from the project's environment variables (see [Set it up on Vercel](#set-it-up-on-vercel-about-20-minutes)). Add them to the project the domain points at, for the environments you use (Production and/or Preview).
- **URLs and caching:** `trailingSlash: true` keeps the canonical URLs (`/shop/`, `/products/x/`), and `/assets/*` is cached for a year.

How it behaves:

- A push to `main` deploys **production**.
- Any other branch or pull request gets its own **preview URL**, which Vercel posts on the PR. Test changes there before merging.
- Preview URLs require a Vercel login by default. To show a preview to someone, use **Share** on the deployment (a shareable link), or change **Settings → Deployment Protection**.

> Vercel's free **Hobby plan is for non-commercial use only**. A live business site needs **Pro** (viewer seats are free).
> Other hosts need Node.js (`npm run build && npm start`) for the order API, accounts and admin; a static-only host can't run them.

---

## Before launch: placeholders to replace

- [ ] **Photos:** placeholder images come from Pexels (free licence, see `design/source-photos/CREDITS.md`). Replace them with real product photography.
- [ ] **Social proof:** ratings, review counts, the reviews themselves and "10,000+ gifters" are **placeholders**. Publish only genuine reviews; Indian consumer-protection rules prohibit fake ones. Add `aggregateRating` to the Product JSON-LD in `src/lib/seo.ts` only when the reviews are real.
- [ ] **Contact details:** WhatsApp number, registered business address and GST details (`site` in `catalog.json`, contact page).
- [ ] **Policies:** privacy, terms, shipping and returns are drafts. Get a legal review, including against the DPDP Act 2023 (the privacy policy should also cover customer accounts).
- [ ] **Payments:** connect Supabase and Razorpay (see [Set it up on Vercel](#set-it-up-on-vercel-about-20-minutes)), test with test keys, then complete Razorpay KYC and switch to live keys.
- [ ] **Shipping fee:** `site.shipping_fee` (₹79) is a placeholder; set your real fee.
- [ ] **Order emails / WhatsApp updates:** not built yet. Customers get the order page link on screen (and in their account if signed in), so this is the next thing to add (for example Resend for email, or a WhatsApp Business API provider).
- [ ] **Accounts:** there's no password reset or email verification yet, and log-in attempts aren't rate-limited beyond a short delay. Add these (and a rate limit, for example a Vercel Firewall rule on `/api/auth/login/`) before promoting accounts.
- [ ] **Customer photos:** decide how long to keep them after delivery (DPDP Act) and say so in the privacy policy. Deleting old photos is manual in Supabase Storage for now.
- [ ] **Not built yet:** cash on delivery, coupon codes (the newsletter currently promises a ₹100 code), courier booking (Shiprocket) and GST invoices.
- [ ] **Forms:** newsletter, contact and bulk-order forms show a success message but don't send anything yet. Connect them to an email or form service.
- [ ] **Social handles, Search Console:** confirm the handles in `catalog.json`, verify Google Search Console and submit `sitemap.xml`.
- [ ] **Brand checks:** confirm the KissaPrints trademark. The song plaque copy deliberately says "song code" rather than using a streaming brand's name.

## Credits

Fonts: Bricolage Grotesque, Instrument Serif, Caveat and UnifrakturMaguntia (mockups only), all under the SIL Open Font License. Placeholder photos: Pexels, under the Pexels License.
