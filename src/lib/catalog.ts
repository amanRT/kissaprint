// The shop's content, from src/data/catalog.json (the single source of truth for products, prices and copy).
// Server-side module: pages read it at build time; client components get only the bits they need as props.
import catalogJson from "@/data/catalog.json";
import statesJson from "@/data/states.json";

export type OptionValue = { label: string; price?: number; photos?: number };
export type Option = { name: string; values: OptionValue[] };
export type RawProduct = {
  slug: string; name: string; category: string; meta: string; price: number; mrp: number; rating: number; reviews: number;
  badges: string[]; tags: string[]; photos: number; short: string; description: string; options: Option[];
  specs: [string, string][]; gallery: string[];
};
export type Product = RawProduct & {
  url: string; categoryName: string; filterTags: string[]; need: number; defaults: number[]; search: string;
};
export type Category = { slug: string; name: string; sub: string; image: string; intro: string; seo: string; url: string; products: Product[] };
export type Occasion = Category;
export type Review = { name: string; city: string; product: string; rating: number; tint: string; text: string };
export type Faq = { q: string; a: string };
export type Site = {
  name: string; url: string; tagline: string; description: string; email: string; whatsapp: string; support_phones: string[];
  hours: string; free_shipping_over: number; shipping_fee: number; dispatch: string; delivery: string;
  social: Record<"instagram" | "youtube" | "facebook", string>; proof: { customers: string; rating: string; reviews: string };
};

type RawCatalog = {
  site: Site; categories: Omit<Category, "url" | "products">[]; occasions: Omit<Occasion, "url" | "products">[];
  products: RawProduct[]; reviews: Review[]; faqs: Faq[];
};
const raw = catalogJson as unknown as RawCatalog;

export const site: Site = raw.site;
export const states: string[] = statesJson;
export const reviews: Review[] = raw.reviews;
export const faqs: Faq[] = raw.faqs;

/** The pre-selected value of an option: the one matching the headline price, else the first.
 *  Pricing on the server (lib/pricing.ts) uses the same rule, so the page and the charge always agree. */
export function defaultIndex(product: { price: number }, option: Option): number {
  const i = option.values.findIndex((v) => v.price === product.price);
  return i < 0 ? 0 : i;
}

const OCCASION_TAG: Record<string, string> = { "for-couples": "couples", "for-her": "her", "for-him": "him", "for-friends": "friends", "for-parents": "parents" };
const catNames = Object.fromEntries(raw.categories.map((c) => [c.slug, c.name]));
const topSlugs = new Set([...raw.products].sort((a, b) => b.reviews - a.reviews).slice(0, 8).map((p) => p.slug));

export const products: Product[] = raw.products.map((p) => {
  const tags = new Set([...p.tags, ...p.badges]);
  if (topSlugs.has(p.slug)) tags.add("top");
  if (p.price < 400) tags.add("under-400");
  const defaults = p.options.map((o) => defaultIndex(p, o));
  let need = p.photos || 0;
  p.options.forEach((o, i) => { need = o.values[defaults[i]].photos ?? need; });
  return {
    ...p, url: `/products/${p.slug}/`, categoryName: catNames[p.category], filterTags: [...tags].sort(), need, defaults,
    search: `${p.name} ${catNames[p.category]} ${p.tags.join(" ")}`.toLowerCase(),
  };
});
export const productsBySlug: Record<string, Product> = Object.fromEntries(products.map((p) => [p.slug, p]));
export const productsByReviews: Product[] = [...products].sort((a, b) => b.reviews - a.reviews);

export const categories: Category[] = raw.categories.map((c) => ({
  ...c, url: `/collections/${c.slug}/`, products: products.filter((p) => p.category === c.slug),
}));
export const categoriesBySlug: Record<string, Category> = Object.fromEntries(categories.map((c) => [c.slug, c]));
export const occasions: Occasion[] = raw.occasions.map((o) => ({
  ...o, url: `/gifts/${o.slug}/`, products: products.filter((p) => p.tags.includes(OCCASION_TAG[o.slug])),
}));

export const NAV_GROUPS: { title: string; links: Category[] }[] = [
  { title: "Prints & keepsakes", links: ["memoroids", "photo-strips", "boarding-passes", "newspapers"].map((s) => categoriesBySlug[s]) },
  { title: "Gifts that last", links: ["song-plaques", "keychains", "fridge-magnets", "hampers"].map((s) => categoriesBySlug[s]) },
  { title: "Wall & desk", links: ["star-maps", "frames", "calendars", "magazines"].map((s) => categoriesBySlug[s]) },
];
