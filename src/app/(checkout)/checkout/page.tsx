import { CheckoutForm } from "@/components/checkout/checkout-form";
import { Icon } from "@/components/ui";
import { site, states } from "@/lib/catalog";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "Checkout | KissaPrints", description: "Secure checkout for your KissaPrints order.", path: "/checkout/", noindex: true });

export default function CheckoutPage() {
  return (
    <div className="wrap checkout" data-co-page>
      <a className="link-arrow co-back" href="/shop/"><Icon name="arrow-left" /> Continue shopping</a>
      <h1>Checkout</h1>
      <CheckoutForm states={states} dispatch={site.dispatch} delivery={site.delivery}
        icons={{ sparkle: <Icon name="sparkle" />, bag: <Icon name="bag" />, shield: <Icon name="shield" /> }} />
    </div>
  );
}
