import { Footer, Header, ShopDialogs } from "@/components/shop/chrome";
import { ShopProvider } from "@/components/shop/provider";
import { site } from "@/lib/catalog";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <ShopProvider freeShipOver={site.free_shipping_over}>
      <Header />
      <main id="main">{children}</main>
      <Footer />
      <ShopDialogs />
    </ShopProvider>
  );
}
