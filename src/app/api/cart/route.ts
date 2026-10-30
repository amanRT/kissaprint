// The signed-in shopper's cart and wishlist, kept on the account (nothing is stored in the browser).
// GET also returns the phone and address from their last order, so checkout can fill them in. GET answers signed-out
// visitors too ({signedIn: false}, empty cart) so every page can ask without logging a 401; saving needs an account.
// ?quote=1 (checkout) also prices the cart in the same request: {quote} or {quote_error} if a line can't be bought.
import { productsBySlug } from "@/lib/catalog";
import { quoteResponse } from "@/lib/server/checkout-quote";
import { ApiError, handle, json } from "@/lib/server/http";
import { CartError, MAX_LINES, priceLine } from "@/lib/server/pricing";

const MAX_BYTES = 200_000;
const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);

/** A cart line as the browser shows it. Checked with the same rules as checkout (priceLine), display fields trimmed. */
function cleanLine(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "Something in your cart looks wrong");
  const l = raw as Record<string, unknown>;
  let priced;
  try {
    priced = priceLine(l);
  } catch (err) {
    throw new ApiError(400, err instanceof CartError ? err.message : "Something in your cart looks wrong");
  }
  return {
    id: str(l.id, 40), slug: priced.slug, name: priced.name, image: str(l.image, 300), price: priced.unit_price, qty: priced.qty,
    options: str(l.options, 300), opts: Object.fromEntries(priced.options), note: priced.note, need: priced.photos_needed,
    photos: priced.photos, ...(priced.layout ? { layout: priced.layout } : {}),
  };
}

export const GET = handle(async (ctx) => {
  if (!(await ctx.session())) return json({ signedIn: false, items: [], wishlist: [], prefill: null });
  const user = await ctx.requireUser();
  const [cart, [last]] = await Promise.all([ctx.store.getCart(user.id), ctx.store.listOrders({ userId: user.id, limit: 1 })]);
  const out: Record<string, unknown> = { signedIn: true, items: cart.items, wishlist: cart.wishlist, prefill: last ? { phone: last.customer.phone, address: last.address } : null };
  if (ctx.query.get("quote") && cart.items.length) {
    try {
      out.quote = await quoteResponse(ctx, cart.items);
    } catch (err) {
      if (!(err instanceof CartError)) throw err;
      out.quote_error = err.message; // e.g. a product that's been switched off - checkout shows it
    }
  }
  return json(out);
});

export const PUT = handle(async (ctx) => {
  const user = await ctx.requireUser();
  const data = await ctx.body();
  const changes: { items?: unknown[]; wishlist?: string[] } = {};
  if (data.items !== undefined) {
    if (!Array.isArray(data.items) || data.items.length > MAX_LINES) throw new ApiError(400, `Please keep it to ${MAX_LINES} items`);
    changes.items = data.items.map(cleanLine);
    if (JSON.stringify(changes.items).length > MAX_BYTES) throw new ApiError(400, "Your cart is too big - please remove something");
  }
  if (data.wishlist !== undefined) {
    if (!Array.isArray(data.wishlist)) throw new ApiError(400, "Wishlist must be a list");
    changes.wishlist = [...new Set(data.wishlist.map(String))].filter((slug) => productsBySlug[slug]).slice(0, 50);
  }
  await ctx.store.saveCart(user.id, changes);
  return json({ ok: true });
});
