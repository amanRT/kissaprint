import { handle, json } from "@/lib/server/http";

/** The dashboard polls this every 30 s (one tiny row) and reloads its list only when the answer changes. */
export const GET = handle(async (ctx) => {
  await ctx.requireAdmin();
  return json({ latest: await ctx.store.latestChange() });
});
