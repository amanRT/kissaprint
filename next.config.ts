import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same URLs as the original static site (/shop/, /products/x/), so links and rankings carry over.
  trailingSlash: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // CSS stays a separate, cacheable file. (experimental.inlineCss put it in the HTML *and* twice more in the
  // RSC payload - ~170 KB extra on every page - which cost more LCP than the saved stylesheet request.)
  async headers() {
    return [
      // Images carry ?v=<content hash> (scripts/prepare-assets.mjs), so they can be cached for a year.
      { source: "/assets/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      { source: "/(checkout|order|account|login|signup)/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
