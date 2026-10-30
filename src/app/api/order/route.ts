import { ApiError, handle, json } from "@/lib/server/http";
import { customerView, same } from "@/lib/server/orders";

/** The customer's order page data - needs the secret token from their order link. */
export const GET = handle(async (ctx) => {
  const order = await ctx.store.getOrder(ctx.query.get("id") ?? "");
  if (!order || !same(order.token, ctx.query.get("t") ?? "")) throw new ApiError(404, "We couldn't find that order");
  return json(customerView(order));
});
