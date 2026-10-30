import { revalidatePath, revalidateTag } from "next/cache";
import { imageUrl } from "@/lib/assets";
import { categories, occasions, products, productsBySlug, type Product } from "@/lib/catalog";
import { ApiError, handle, json } from "@/lib/server/http";
import { hiddenNow, PRODUCTS_TAG } from "@/lib/server/visibility";
import { visibilityFrom, type Visibility } from "@/lib/visible";

/** Categories/occasions where `p` is the only product on the website: hiding it hides them too. */
const lastIn = (p: Product, vis: Visibility) =>
  [...categories, ...occasions].filter((g) => g.products.some((x) => x.slug === p.slug) && vis.products(g.products).every((x) => x.slug === p.slug)).map((g) => g.name);

/** Every product with whether it's on the website (rows exist only for products someone has changed). */
export const GET = handle(async (ctx) => {
  await ctx.requireAdmin();
  const settings = await ctx.store.productSettings();
  const rows = Object.fromEntries(settings.map((r) => [r.slug, r]));
  const vis = visibilityFrom(new Set(settings.filter((r) => r.hidden).map((r) => r.slug)));
  return json({
    products: products.map((p) => ({
      slug: p.slug, name: p.name, category: p.categoryName, price: p.price, url: p.url, image: imageUrl(p.slug, 120, "webp"),
      hidden: Boolean(rows[p.slug]?.hidden), updated_at: rows[p.slug]?.updated_at ?? null, updated_by: rows[p.slug]?.updated_by ?? "",
      last_in: vis.product(p.slug) ? lastIn(p, vis) : [],
    })),
  });
});

/** Show or hide one product. The website updates on the next visit to each page; ordering is blocked at once. */
export const POST = handle(async (ctx) => {
  const admin = await ctx.requireAdmin();
  const data = await ctx.body();
  const p = productsBySlug[String(data.slug ?? "")];
  if (!p) throw new ApiError(400, "Unknown product");
  if (typeof data.hidden !== "boolean") throw new ApiError(400, "Say whether the product should be hidden");
  const row = await ctx.store.setProductHidden(p.slug, data.hidden, admin.name || admin.email);
  // Expire the cached hidden list (no stale copies: the next visit re-renders), then every page under the root layout.
  revalidateTag(PRODUCTS_TAG, { expire: 0 });
  revalidatePath("/", "layout");
  revalidatePath("/search.json");
  const vis = visibilityFrom(await hiddenNow(ctx.store));
  // Groups now empty because of this product (they drop off the website), and the new "last one" warnings.
  const emptied = row.hidden ? [...categories, ...occasions].filter((g) => g.products.some((x) => x.slug === p.slug) && !vis.groups([g]).length).map((g) => g.name) : [];
  return json({ product: { slug: p.slug, name: p.name, hidden: row.hidden, updated_at: row.updated_at, updated_by: row.updated_by,
    last_in: row.hidden ? [] : lastIn(p, vis) }, emptied });
});
