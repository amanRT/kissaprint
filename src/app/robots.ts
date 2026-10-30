import type { MetadataRoute } from "next";
import { site } from "@/lib/catalog";

export const dynamic = "force-static";

// /admin/ is deliberately not listed (robots.txt is public); it sends noindex instead.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/thank-you/", "/checkout/", "/order/", "/account/", "/login/", "/signup/", "/api/"] },
    sitemap: `${site.url}/sitemap.xml`,
  };
}
