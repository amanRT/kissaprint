// Page metadata and schema.org JSON-LD. metadataBase (root layout) makes every relative URL absolute.
import type { Metadata } from "next";
import { fileUrl, image, imageUrl } from "./assets";
import { site, type Faq, type Product } from "./catalog";

type Meta = { title: string; description: string; path: string; noindex?: boolean; ogImage?: string; ogImageAlt?: string };

export function pageMeta({ title, description, path, noindex, ogImage, ogImageAlt }: Meta): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    robots: noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: "website", siteName: site.name, locale: "en_IN", title, description, url: path,
      images: [{ url: ogImage ?? fileUrl("/assets/img/og-default.jpg"), alt: ogImageAlt ?? "KissaPrints personalised photo gifts" }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export function clip(text: string, n = 158) {
  if (text.length <= n) return text;
  return text.slice(0, n - 1).replace(/\s+\S*$/, "").replace(/[,;-]+$/, "") + "…";
}

const abs = (path: string) => site.url + path;

export function ldOrg() {
  const allWeek = { "@type": "OpeningHoursSpecification", opens: "00:00", closes: "23:59",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] };
  const phones = site.support_phones.map((n) => `+91-${n}`);
  return {
    "@context": "https://schema.org", "@type": "OnlineStore", "@id": abs("/#org"), name: site.name, url: abs("/"),
    logo: abs("/icon-512.png"), image: abs(fileUrl("/assets/img/og-default.jpg")), description: site.description,
    email: site.email, areaServed: "IN", sameAs: Object.values(site.social),
    ...(phones.length && {
      telephone: phones[0],
      contactPoint: phones.map((telephone) => ({ "@type": "ContactPoint", telephone, contactType: "customer support", areaServed: "IN", hoursAvailable: allWeek })),
    }),
  };
}

export const ldWebsite = () => ({
  "@context": "https://schema.org", "@type": "WebSite", "@id": abs("/#website"), name: site.name, url: abs("/"),
  inLanguage: "en-IN", publisher: { "@id": abs("/#org") },
});

export const ldBreadcrumbs = (crumbs: [string, string][]) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: crumbs.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(url) })),
});

export const ldFaq = (items: Faq[]) => ({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

export const ldItemList = (items: Product[]) => ({
  "@context": "https://schema.org", "@type": "ItemList",
  itemListElement: items.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: abs(p.url), name: p.name })),
});

// Add "aggregateRating"/"review" only once the reviews are genuine customer reviews.
export const ldProduct = (p: Product, inStock = true) => ({
  "@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.slug,
  image: p.gallery.map((g) => abs(imageUrl(g, image(g).widths.at(-1)!, "webp"))),
  description: p.description, category: p.categoryName, brand: { "@type": "Brand", name: site.name },
  offers: {
    "@type": "Offer", url: abs(p.url), priceCurrency: "INR", price: String(p.price),
    availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", itemCondition: "https://schema.org/NewCondition", seller: { "@id": abs("/#org") },
  },
});
