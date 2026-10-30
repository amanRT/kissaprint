// Listing pages: /shop/, /collections/<slug>/ (incl. bestsellers) and /gifts/<slug>/ - same copy as the original site.
import type { CollectionProps } from "@/components/collection/listing";
import { categories, categoriesBySlug, occasions, products, productsByReviews, site } from "./catalog";
import { inr } from "./format";
import { clip, pageMeta } from "./seo";
import { visibilityFrom, type Visibility } from "./visible";

type Listing = CollectionProps & { title: string; description: string };
// `vis`: products switched off in /admin/products/ never appear, and neither do chips/links to categories they empty.
const ALL = visibilityFrom(new Set());
const chips = (vis: Visibility): [string, string][] => [["All gifts", "/shop/"], ["Bestsellers", "/collections/bestsellers/"],
  ...vis.groups(categories).map((c): [string, string] => [c.name, c.url])];

export function shopListing(vis: Visibility = ALL): Listing {
  const intro = "Polaroid-style prints, photo strips, song plaques, star maps, magazines, calendars, keychains and hampers - every one of them made with your photos.";
  return {
    path: "/shop/", heading: "All personalised gifts", intro, items: vis.products(products), crumbs: [["Home", "/"], ["All gifts", "/shop/"]],
    title: "Shop Personalised Photo Gifts Online in India | KissaPrints", description: clip(intro),
    seoTitle: "Personalised photo gifts for every occasion",
    seoParas: [
      "KissaPrints makes personalised photo gifts in India, designed around the photos already on your phone. Choose a format, add your pictures and a few words, and we'll print, pack and deliver it across India.",
      "Looking for something specific? Shop gifts for couples, friends or parents, or explore our bestsellers for the keepsakes people order again and again.",
    ],
    related: vis.groups(categories).slice(0, 6), chips: chips(vis),
  };
}

export const COLLECTION_SLUGS = ["bestsellers", ...categories.map((c) => c.slug)];

export function collectionListing(slug: string, vis: Visibility = ALL): Listing | null {
  if (slug === "bestsellers") {
    const intro = "The keepsakes our customers order again and again - start here if you can't decide.";
    return {
      path: "/collections/bestsellers/", heading: "Bestsellers", intro, items: vis.products(productsByReviews).slice(0, 8),
      crumbs: [["Home", "/"], ["Bestsellers", "/collections/bestsellers/"]],
      title: "Bestselling Personalised Gifts | KissaPrints", description: clip(intro), seoTitle: "Our most-loved personalised gifts",
      seoParas: ["From Classic Memoroids to song plaques and photo booth strips, these are the gifts that get the biggest reactions. Every one is printed on premium material and packed gift-ready."],
      related: vis.groups(categories).slice(0, 6), chips: chips(vis),
    };
  }
  const c = categoriesBySlug[slug];
  if (!c) return null;
  const i = categories.indexOf(c);
  return {
    path: c.url, heading: c.name, intro: c.intro, items: vis.products(c.products), crumbs: [["Home", "/"], ["Shop", "/shop/"], [c.name, c.url]],
    title: `${c.seo} | KissaPrints`, description: clip(c.intro), seoTitle: c.seo,
    seoParas: [c.intro, `Every ${c.name.toLowerCase()} order is checked by our team before printing, packed gift-ready and dispatched within ${site.dispatch}. Free shipping on orders above ${inr(site.free_shipping_over)}.`],
    related: vis.groups(categories.filter((x) => x.slug !== c.slug)).slice(i % 6, (i % 6) + 6), chips: chips(vis),
  };
}

export const OCCASION_SLUGS = occasions.map((o) => o.slug);

export function occasionListing(slug: string, vis: Visibility = ALL): Listing | null {
  const o = occasions.find((x) => x.slug === slug);
  if (!o) return null;
  return {
    path: o.url, heading: `Gifts ${o.name.toLowerCase()}`, intro: o.intro, items: vis.products(o.products), crumbs: [["Home", "/"], ["Gifts", "/shop/"], [o.name, o.url]],
    title: `${o.seo} | KissaPrints`, description: clip(o.intro), seoTitle: o.seo,
    seoParas: [o.intro, "Can't choose? Our Affection Box hamper bundles five personalised keepsakes, wrapped and ready to give."],
    related: vis.groups(categories).slice(0, 6), chips: chips(vis),
  };
}

// A category whose products are all switched off stays reachable but keeps out of search results until it's back.
export const listingMeta = (l: Listing) => pageMeta({ title: l.title, description: l.description, path: l.path, noindex: !l.items.length });
