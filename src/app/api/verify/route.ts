import { ApiError, handle, json } from "@/lib/server/http";
import { markPaidChanges, PAID } from "@/lib/server/orders";
import { PaymentError, slimPayment } from "@/lib/server/payments";

/** The browser's success callback from Razorpay Checkout. The webhook confirms independently. */
export const POST = handle(async (ctx) => {
  const data = await ctx.body();
  const store = ctx.store;
  const order = await store.getOrder(String(data.id ?? ""));
  if (!order) throw new ApiError(404, "Order not found");
  if (PAID.includes(order.status)) return json({ ok: true, id: order.id, status: order.status });
  if (order.status !== "pending") throw new ApiError(409, "This order was cancelled - please contact us");
  const gw = ctx.gateway;
  if (order.gateway !== ctx.gatewayLabel) throw new ApiError(409, "This order was started with a different payment setup - please place it again");
  const payId = String(data.razorpay_payment_id ?? "");
  if (!payId || !gw.verifyPayment(order.razorpay_order_id ?? "", payId, data.razorpay_signature)) {
    throw new ApiError(400, `We couldn't confirm this payment. If money left your account, contact us with your order number ${order.id} and we'll sort it out.`);
  }
  let payment: Record<string, unknown> | null = null;
  try { payment = await gw.fetchPayment(payId); } catch (err) { if (!(err instanceof PaymentError)) throw err; } // nice to have: the signature already proves payment
  const updated = await store.updateOrder(order.id, markPaidChanges(order, payId, slimPayment(payment, payId), "checkout"), ["pending"]);
  const final = updated ?? (await store.getOrder(order.id)); // null = the webhook got there first
  return json({ ok: true, id: final!.id, status: final!.status });
});
