import { ApiError, handle, json, log } from "@/lib/server/http";
import { markPaidChanges, refundChanges, withStatus } from "@/lib/server/orders";
import { slimPayment } from "@/lib/server/payments";

/** Razorpay -> us. Marks orders paid even if the customer closed the tab before the redirect, and records refunds
 *  made in the Razorpay dashboard (refund.created / refund.processed / refund.failed). */
export const POST = handle(async (ctx) => {
  const gw = ctx.gateway;
  if (gw.name !== "razorpay") throw new ApiError(404, "Not found");
  if (!ctx.cfg.razorpayWebhookSecret) throw new ApiError(503, "RAZORPAY_WEBHOOK_SECRET isn't set");
  const raw = Buffer.from(await ctx.req.arrayBuffer()); // the signature covers these exact bytes
  if (!gw.verifyWebhook(raw, ctx.req.headers.get("x-razorpay-signature") ?? "")) throw new ApiError(400, "Invalid signature");
  const event = JSON.parse(raw.toString("utf8"));
  const kind: string = event.event ?? "";
  const pay = event.payload?.payment?.entity ?? {};
  const isRefund = kind.startsWith("refund.");
  if (!(["payment.captured", "order.paid", "payment.failed"].includes(kind) || isRefund) || !pay.order_id) return json({ ok: true, ignored: kind });
  const store = ctx.store;
  const order = await store.findByRazorpayOrder(pay.order_id);
  if (!order) return json({ ok: true, ignored: "unknown order" });
  if (isRefund) {
    const changes = refundChanges(order, kind, event.payload?.refund?.entity ?? {}, Number(pay.amount_refunded ?? 0));
    if (changes) await store.updateOrder(order.id, changes);
    return json({ ok: true });
  }
  if (kind === "payment.failed") {
    if (order.status === "pending") {
      await store.updateOrder(order.id, withStatus(order, "pending", `Payment attempt failed: ${String(pay.error_description || "no reason given").slice(0, 140)}`), ["pending"]);
    }
    return json({ ok: true });
  }
  if (pay.amount !== order.total * 100 || (pay.currency || "INR") !== "INR") {
    log(`amount mismatch on ${order.id}: paid ${pay.amount} ${pay.currency}, expected ${order.total * 100}`);
    await store.updateOrder(order.id, withStatus(order, order.status, "Razorpay amount doesn't match the order - check the dashboard"));
    return json({ ok: true, ignored: "amount mismatch" });
  }
  if (order.status === "pending") await store.updateOrder(order.id, markPaidChanges(order, pay.id, slimPayment(pay, pay.id), "webhook"), ["pending"]);
  return json({ ok: true });
});
