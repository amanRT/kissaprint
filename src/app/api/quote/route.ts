import { site } from "@/lib/catalog";
import { handle, json, type Ctx } from "@/lib/server/http";
import { quote } from "@/lib/server/pricing";
import { hiddenNow } from "@/lib/server/visibility";

/** Signed in with a team test account? Then checkout says the order will skip payment. */
async function isTester(ctx: Ctx) {
  const claims = await ctx.session();
  return Boolean(claims && (await ctx.store.getUserById(claims.sub))?.is_tester);
}

/** The checkout summary, priced on the server. */
export const POST = handle(async (ctx) => {
  const q = quote((await ctx.body()).items, await hiddenNow(ctx.store));
  const lines = q.lines.map(({ photos, ...line }) => ({ ...line, photos: photos.length }));
  return json({ lines, subtotal: q.subtotal, shipping: q.shipping, total: q.total, free_shipping_over: site.free_shipping_over,
    payments: ctx.cfg.payments || "off", test_mode: ctx.cfg.testMode, test_account: await isTester(ctx) });
});
