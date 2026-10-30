import { quoteResponse } from "@/lib/server/checkout-quote";
import { handle, json } from "@/lib/server/http";

/** The checkout summary, priced on the server. Signed-in shoppers only (proxy.ts checks the cookie first). */
export const POST = handle(async (ctx) => {
  await ctx.requireUser();
  return json(await quoteResponse(ctx, (await ctx.body()).items));
});
