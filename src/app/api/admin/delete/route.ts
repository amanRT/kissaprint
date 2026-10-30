import { ApiError, handle, json } from "@/lib/server/http";
import { isTest } from "@/lib/server/orders";

/** Remove a test order and its photos. Real (live-payment) orders can never be deleted from here. */
export const POST = handle(async (ctx) => {
  await ctx.requireAdmin();
  const store = ctx.store;
  const order = await store.getOrder(String((await ctx.body()).id ?? ""));
  if (!order) throw new ApiError(404, "Order not found");
  if (!isTest(order)) throw new ApiError(400, "Only test orders can be deleted. Cancel or refund real orders instead.");
  await store.deletePhotos(order.items.flatMap((line) => line.photos.map((ph) => ph.key)));
  await store.deleteOrder(order.id);
  return json({ ok: true, id: order.id });
});
