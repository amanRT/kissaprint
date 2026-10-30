import { ApiError, handle, json } from "@/lib/server/http";
import { LocalStore, MAX_PHOTO_MB } from "@/lib/server/store";

/** Local development only: the stand-in for Supabase's signed upload URLs. */
export const PUT = handle(async (ctx) => {
  const store = ctx.store;
  if (!(store instanceof LocalStore)) throw new ApiError(404, "Not found");
  const key = ctx.query.get("key") ?? "";
  if (!store.validUpload(key, ctx.query.get("sig") ?? "")) throw new ApiError(403, "This upload link isn't valid");
  const data = Buffer.from(await ctx.req.arrayBuffer());
  if (!data.length) throw new ApiError(400, "Empty file");
  if (data.length > MAX_PHOTO_MB * 1024 * 1024) throw new ApiError(413, `Photos can be up to ${MAX_PHOTO_MB} MB each`);
  store.saveUpload(key, data);
  return json({ ok: true, key });
});
