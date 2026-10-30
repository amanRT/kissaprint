// What the shop shows, given the products switched off in /admin/products/. A category or occasion counts as live
// only while at least one of its products is on the website, so no tile, menu item, chip or footer link ever
// leads to an empty page. (Fetching the hidden list is server-only: see lib/server/visibility.ts.)
import { categories, occasions, products, type Category, type Product } from "./catalog";

export type Visibility = {
  hidden: ReadonlySet<string>;
  product: (slug: string) => boolean;
  products: <T extends Product>(list: T[]) => T[];
  /** Categories or occasions with at least one visible product. */
  groups: <T extends Category>(list: T[]) => T[];
  /** For hand-written links: false only for a product, category or occasion page that's switched off or empty. */
  url: (url: string) => boolean;
};

export function visibilityFrom(hidden: ReadonlySet<string>): Visibility {
  const product = (slug: string) => !hidden.has(slug);
  const live = (g: Category) => g.products.some((p) => product(p.slug));
  const byUrl = new Map<string, boolean>([
    ...products.map((p): [string, boolean] => [p.url, product(p.slug)]),
    ...[...categories, ...occasions].map((g): [string, boolean] => [g.url, live(g)]),
  ]);
  return {
    hidden, product,
    products: (list) => list.filter((p) => product(p.slug)),
    groups: (list) => list.filter(live),
    url: (url) => byUrl.get(url) ?? true,
  };
}
