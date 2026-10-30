// Which products are on the website. Admins hide/unhide them at /admin/products/ (e.g. out of stock); a hidden
// product disappears from every listing, the search, the menus and the sitemap, its page says it's unavailable,
// and the server refuses to quote, upload for or order it.
import { unstable_cache } from "next/cache";
import { settings } from "./config";
import { visibilityFrom, type Visibility } from "../visible";
import { makeStore, type Store } from "./store";

/** Cache tag on everything rendered from the hidden list; the admin's toggle invalidates it. */
export const PRODUCTS_TAG = "products";

/** Straight from the database - for decisions that must be exact (pricing and ordering). */
export async function hiddenNow(store: Store): Promise<Set<string>> {
  return new Set((await store.productSettings()).filter((r) => r.hidden).map((r) => r.slug));
}

// Pages stay static: they read a cached copy, which the admin's change expires straight away (revalidateTag).
// The hourly refresh only matters if someone edits the table by hand. If the database can't be read, rendering
// fails and Next.js keeps serving the previous page, so a hidden product never quietly comes back.
// Keyed by the store too: Next's data cache outlives a deploy, so a cached list must never cross databases.
/** For rendering pages and the search index. */
export async function hiddenProducts(): Promise<Set<string>> {
  const cfg = settings();
  const store = makeStore(cfg);
  if (!store) return new Set();
  const where = cfg.storage === "supabase" ? cfg.supabaseUrl : cfg.dataDir;
  const cached = unstable_cache(async () => [...(await hiddenNow(store))], ["hidden-products", cfg.storage, where], { tags: [PRODUCTS_TAG], revalidate: 3600 });
  return new Set(await cached());
}

/** Everything a page needs to leave out switched-off products and the categories they empty. */
export async function shopVisibility(): Promise<Visibility> {
  return visibilityFrom(await hiddenProducts());
}
