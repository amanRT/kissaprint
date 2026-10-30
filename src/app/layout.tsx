import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { IconSprite } from "@/components/ui";
import { site } from "@/lib/catalog";
import "@/styles/main.css";

// Self-hosted, subset fonts (tools/build_fonts.py). next/font preloads them and adds size-adjusted fallbacks,
// so text renders immediately and doesn't shift when the real font arrives.
const bricolage = localFont({ src: "../fonts/bricolage.woff2", weight: "400 800", style: "normal", display: "swap", variable: "--font-bricolage", adjustFontFallback: "Arial" });
const instrument = localFont({ src: "../fonts/instrument-serif-italic.woff2", weight: "400", style: "italic", display: "swap", variable: "--font-instrument", adjustFontFallback: "Times New Roman" });
const caveat = localFont({ src: "../fonts/caveat.woff2", weight: "600", style: "normal", display: "swap", variable: "--font-caveat", adjustFontFallback: "Arial", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: site.name,
  description: site.description,
  applicationName: site.name,
  icons: { icon: [{ url: "/favicon.ico", sizes: "48x48" }, { url: "/favicon.svg", type: "image/svg+xml" }], apple: "/apple-touch-icon.png" },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#fff9f3" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${bricolage.variable} ${instrument.variable} ${caveat.variable}`}>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <IconSprite />
        {children}
      </body>
    </html>
  );
}
