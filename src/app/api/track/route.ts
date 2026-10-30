import { ApiError, handle, json } from "@/lib/server/http";
import { contactMatches } from "@/lib/server/orders";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Order number + email/phone -> the order link token. */
export const POST = handle(async (ctx) => {
  const data = await ctx.body();
  let id = String(data.id ?? "").trim().toUpperCase().replace(/\s/g, "");
  if (id && !id.startsWith("KP-")) id = "KP-" + id.replace(/^KP/, "");
  const order = await ctx.store.getOrder(id);
  if (!order || !contactMatches(order, data.contact)) {
    await pause(600); // slows down guessing
    throw new ApiError(404, "We couldn't find an order with those details. Check the order number (like KP-7XK2QD) and use the email or mobile number you checked out with.");
  }
  return json({ id: order.id, token: order.token });
});
