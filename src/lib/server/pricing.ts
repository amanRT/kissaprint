// Server-side pricing from catalog.json. Prices sent by the browser are never trusted.
import { defaultIndex, productsBySlug, site } from "../catalog";

export const MAX_LINES = 20;
export const MAX_QTY = 20;
export const MAX_PHOTOS = 100;
// Upload keys are issued by /api/uploads/ (see store.newPhotoKey) - anything else is rejected.
export const PHOTO_KEY = /^up\/\d{8}\/[0-9a-f]{32}\.(?:jpg|png|webp|heic|heif)$/;

/** A cart the server can't price: unknown product or option, bad quantity, too many photos... */
export class CartError extends Error {}

export type OrderPhoto = { key: string; name: string; size: number };
export type PricedLine = {
  slug: string; name: string; options: [string, string][]; note: string; qty: number;
  unit_price: number; line_total: number; photos: OrderPhoto[]; photos_needed: number;
};
export type Quote = { lines: PricedLine[]; subtotal: number; shipping: number; total: number };

export const shippingFor = (subtotal: number) => (subtotal >= site.free_shipping_over ? 0 : site.shipping_fee);

function cleanPhotos(raw: unknown): OrderPhoto[] {
  if (raw === undefined || raw === null || raw === "") return [];
  if (!Array.isArray(raw) || raw.length > MAX_PHOTOS) throw new CartError(`Up to ${MAX_PHOTOS} photos per item, please`);
  return raw.map((ph) => {
    const key = ph && typeof ph === "object" ? (ph as { key?: unknown }).key : undefined;
    if (typeof key !== "string" || !PHOTO_KEY.test(key)) throw new CartError("One of your photos didn't upload properly - please remove it and add it again");
    // eslint-disable-next-line no-control-regex
    const name = String((ph as { name?: unknown }).name || "photo").replace(/[\x00-\x1f/\\]+/g, "").slice(-120) || "photo";
    const size = Math.max(0, Number.parseInt(String((ph as { size?: unknown }).size ?? 0), 10) || 0);
    return { key, name, size };
  });
}

/** Validate one cart line and price it from the catalog. `hidden`: products switched off in /admin/products/. */
export function priceLine(line: unknown, hidden: ReadonlySet<string> = new Set()): PricedLine {
  if (!line || typeof line !== "object" || Array.isArray(line)) throw new CartError("Something in your cart looks wrong - please remove it and add it again");
  const l = line as Record<string, unknown>;
  const p = productsBySlug[String(l.slug ?? "")];
  if (!p) throw new CartError("A product in your cart is no longer available");
  if (hidden.has(p.slug)) throw new CartError(`${p.name} is currently unavailable - please remove it from your cart`);
  const chosen = (l.opts ?? {}) as Record<string, unknown>;
  if (typeof chosen !== "object" || Array.isArray(chosen)) throw new CartError(`${p.name}: please choose your options again`);
  let unit = p.price;
  let needed = p.photos || 0;
  const options: [string, string][] = [];
  for (const opt of p.options) {
    const label = chosen[opt.name];
    const value = label === undefined || label === null ? opt.values[defaultIndex(p, opt)] : opt.values.find((v) => v.label === label);
    if (!value) throw new CartError(`${p.name}: “${String(label)}” isn't available any more - please choose again`);
    // Same rule as the product page: a priced value sets the unit price, a counted one the photos needed.
    unit = value.price ?? unit;
    needed = value.photos ?? needed;
    options.push([opt.name, value.label]);
  }
  const qty = Number(l.qty ?? 1);
  if (!Number.isInteger(qty)) throw new CartError("Please check the quantities in your cart");
  if (qty < 1 || qty > MAX_QTY) throw new CartError(`You can order 1 to ${MAX_QTY} of each item`);
  const note = String(l.note ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return { slug: p.slug, name: p.name, options, note, qty, unit_price: unit, line_total: unit * qty, photos: cleanPhotos(l.photos), photos_needed: needed };
}

/** Price a whole cart: lines, subtotal, shipping and total (rupees, GST included). */
export function quote(lines: unknown, hidden: ReadonlySet<string> = new Set()): Quote {
  if (!Array.isArray(lines) || !lines.length) throw new CartError("Your cart is empty");
  if (lines.length > MAX_LINES) throw new CartError(`Please keep it to ${MAX_LINES} items per order`);
  const priced = lines.map((l) => priceLine(l, hidden));
  const subtotal = priced.reduce((sum, l) => sum + l.line_total, 0);
  const shipping = shippingFor(subtotal);
  return { lines: priced, subtotal, shipping, total: subtotal + shipping };
}
