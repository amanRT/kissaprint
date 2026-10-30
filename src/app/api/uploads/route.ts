import { productsBySlug } from "@/lib/catalog";
import { ApiError, handle, json } from "@/lib/server/http";
import { MAX_PHOTO_MB, newPhotoKey } from "@/lib/server/store";
import { hiddenNow } from "@/lib/server/visibility";

/** One-time upload URLs for up to 20 photos; the browser PUTs each file straight to storage. */
export const POST = handle(async (ctx) => {
  await ctx.requireUser(); // photos belong to an account (proxy.ts checks the cookie first)
  const data = await ctx.body();
  const files = data.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > 20) throw new ApiError(400, "Send between 1 and 20 photos at a time");
  const p = productsBySlug[String(data.slug ?? "")];
  if (!p) throw new ApiError(400, "Unknown product");
  if ((await hiddenNow(ctx.store)).has(p.slug)) throw new ApiError(400, `${p.name} is currently unavailable`);
  const items = files.map((f: { name?: unknown; type?: unknown; size?: unknown }) => {
    if (Number(f?.size ?? 0) > MAX_PHOTO_MB * 1024 * 1024) throw new ApiError(400, `Photos can be up to ${MAX_PHOTO_MB} MB each`);
    try {
      return newPhotoKey(String(f?.name ?? ""), String(f?.type ?? ""));
    } catch (err) {
      throw new ApiError(400, (err as Error).message);
    }
  });
  return json({ uploads: await ctx.store.uploadTargets(items) });
});
