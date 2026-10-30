import { NotFoundBody } from "@/components/content/not-found";
import { MinimalFooter, MinimalHeader } from "@/components/shop/chrome";

// (Next.js adds <meta name="robots" content="noindex"> to every 404 itself.)
export const metadata = { title: "Page not found | KissaPrints", description: "This page couldn't be found." };

// Next.js embeds this root 404 fallback in the RSC payload of every page, so it stays light (no shop header,
// mega menu or footer, which would otherwise be sent twice per page). 404s from inside the shop use
// app/(shop)/not-found.tsx and get the full shop chrome from that layout.
export default function NotFound() {
  return (
    <>
      <MinimalHeader secure={false} />
      <main id="main"><NotFoundBody /></main>
      <MinimalFooter />
    </>
  );
}
