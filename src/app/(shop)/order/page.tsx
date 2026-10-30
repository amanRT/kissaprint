import { OrderView } from "@/components/order/order-view";
import { Icon } from "@/components/ui";
import { site } from "@/lib/catalog";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "Your order | KissaPrints", description: "Your KissaPrints order status.", path: "/order/", noindex: true });

export default function OrderPage() {
  return (
    <div className="wrap order-page">
      <OrderView email={site.email} phones={site.support_phones} whatsapp={site.whatsapp} dispatch={site.dispatch}
        checkIcon={<Icon name="check" />} clockIcon={<Icon name="clock" />} arrow={<Icon name="arrow-right" className="icon--arrow" />} />
    </div>
  );
}
