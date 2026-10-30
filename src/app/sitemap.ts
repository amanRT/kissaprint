import type { MetadataRoute } from "next";
import { INFO_PAGES } from "@/components/content/pages";
import { categories, occasions, products, site } from "@/lib/catalog";
import { shopVisibility } from "@/lib/server/visibility";

export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const vis = await shopVisibility(); // no switched-off products, nor categories/occasions they leave empty
  const now = new Date();
  const paths = [
    "/", "/shop/", "/collections/bestsellers/",
    ...vis.groups(categories).map((c) => c.url), ...vis.groups(occasions).map((o) => o.url), ...vis.products(products).map((p) => p.url),
    ...Object.entries(INFO_PAGES).filter(([, page]) => !page.noindex).map(([slug]) => `/${slug}/`), "/track-order/",
  ];
  return paths.map((path) => ({ url: site.url + path, lastModified: now }));
}
