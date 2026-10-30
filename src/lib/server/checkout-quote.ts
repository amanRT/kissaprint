// The checkout summary, priced on the server - shared by POST /api/quote/ and GET /api/cart/?quote=1 (which saves
// checkout a second round trip). Prices, shipping and photo counts always come from the catalog, never the browser.
import { site } from "../catalog";
import type { Ctx } from "./http";
import { quote } from "./pricing";
import { hiddenNow } from "./visibility";

/** Signed in with a team test account? Then checkout says the order will skip payment. */
async function isTester(ctx: Ctx) {
  const claims = await ctx.session();
  return Boolean(claims && (await ctx.store.getUserById(claims.sub))?.is_tester);
}

export async function quoteResponse(ctx: Ctx, items: unknown) {
  const [hidden, testAccount] = await Promise.all([hiddenNow(ctx.store), isTester(ctx)]);
  const q = quote(items, hidden);
  const lines = q.lines.map(({ photos, ...line }) => ({ ...line, photos: photos.length }));
  return { lines, subtotal: q.subtotal, shipping: q.shipping, total: q.total, free_shipping_over: site.free_shipping_over,
    payments: ctx.cfg.payments || "off", test_mode: ctx.cfg.testMode, test_account: testAccount };
}
