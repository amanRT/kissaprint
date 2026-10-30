import { ApiError, handle } from "@/lib/server/http";
import { LocalStore, PHOTO_MIME } from "@/lib/server/store";

/** Local development only - in production the dashboard gets signed Supabase URLs instead. */
export const GET = handle(async (ctx) => {
  await ctx.requireAdmin();
  const store = ctx.store;
  if (!(store instanceof LocalStore)) throw new ApiError(404, "Not found");
  const key = ctx.query.get("key") ?? "";
  const data = store.readPhoto(key);
  if (!data) throw new ApiError(404, "Photo not found");
  return new Response(new Uint8Array(data), { headers: { "Content-Type": PHOTO_MIME[key.split(".").pop()!], "Cache-Control": "private, no-store" } });
});
