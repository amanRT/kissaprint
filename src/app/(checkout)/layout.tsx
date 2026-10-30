import { MinimalFooter, MinimalHeader } from "@/components/shop/chrome";
import "@/styles/checkout.css";

/** Checkout gets a calm header (logo + "Secure checkout") with no menus to wander off into. */
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MinimalHeader />
      <main id="main">{children}</main>
      <MinimalFooter />
    </>
  );
}
