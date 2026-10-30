import { ApiError, handle, json } from "@/lib/server/http";
import { adminSummary, STATUSES, type Status } from "@/lib/server/orders";

// Admin list tabs -> statuses
const TABS: Record<string, readonly Status[] | null> = {
  new: ["paid"], printing: ["printing"], shipped: ["shipped"], delivered: ["delivered"], unpaid: ["pending"], closed: ["cancelled", "refunded"], all: null,
};

export const GET = handle(async (ctx) => {
  await ctx.requireAdmin();
  const tab = ctx.query.get("tab") || "new";
  if (!(tab in TABS)) throw new ApiError(400, "Unknown tab");
  const store = ctx.store;
  // The work queues (to print, printing) run oldest first so nobody waits longest; the rest newest first.
  const [rows, counts, latest] = await Promise.all([
    store.listOrders({ statuses: TABS[tab], q: (ctx.query.get("q") ?? "").trim(), oldestFirst: tab === "new" || tab === "printing" }),
    store.statusCounts(),
    store.latestChange(),
  ]);
  const tabCounts = Object.fromEntries(Object.entries(TABS).map(([t, sts]) => [t, (sts ?? STATUSES).reduce((n, s) => n + (counts[s] ?? 0), 0)]));
  return json({ orders: rows.map(adminSummary), counts: tabCounts, latest });
});
