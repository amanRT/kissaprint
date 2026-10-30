import { ApiError, handle, json } from "@/lib/server/http";
import { now, STATUSES, withStatus, type Order, type Status } from "@/lib/server/orders";

export const GET = handle(async (ctx) => {
  await ctx.requireAdmin();
  const order = await ctx.store.getOrder(ctx.query.get("id") ?? "");
  if (!order) throw new ApiError(404, "Order not found");
  const keys = order.items.flatMap((line) => line.photos.map((ph) => ph.key));
  return json({ order, photos: await ctx.store.photoUrls(keys) });
});

/** Status, courier tracking and internal notes. Refunds themselves happen in the Razorpay dashboard. */
export const POST = handle(async (ctx) => {
  const admin = await ctx.requireAdmin();
  const data = await ctx.body();
  const store = ctx.store;
  const order = await store.getOrder(String(data.id ?? ""));
  if (!order) throw new ApiError(404, "Order not found");
  const status = (data.status || order.status) as Status;
  if (!STATUSES.includes(status) || (status === "pending" && order.status !== "pending")) throw new ApiError(400, "Please pick a valid status", "status");
  let changes: Partial<Order> = {};
  if ("notes" in data) changes.notes = String(data.notes ?? "").slice(0, 4000);
  if ("tracking" in data) {
    const t = (data.tracking && typeof data.tracking === "object" ? data.tracking : {}) as Record<string, unknown>;
    const tracking = { courier: String(t.courier ?? "").trim().slice(0, 60), number: String(t.number ?? "").trim().slice(0, 80), url: String(t.url ?? "").trim().slice(0, 500) };
    if (tracking.url && !/^https?:\/\//.test(tracking.url)) throw new ApiError(400, "The tracking link should start with https://", "url");
    changes.tracking = tracking.courier || tracking.number || tracking.url ? tracking : null;
  }
  const note = String(data.note ?? "").trim().slice(0, 280);
  if (status !== order.status || note) changes = withStatus(order, status, note ? `${note} (${admin.name || admin.email})` : "", changes);
  else changes.updated_at = now();
  return json({ order: await store.updateOrder(order.id, changes) });
});
