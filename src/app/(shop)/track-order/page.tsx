import { InfoView } from "@/components/content/pages";
import { TrackForm } from "@/components/content/track-form";
import { PhoneLinks } from "@/components/shop/chrome";
import { Icon } from "@/components/ui";
import { site } from "@/lib/catalog";
import { pageMeta } from "@/lib/seo";

// Its own route rather than an entry in app/(shop)/[page]: the form needs checkout.css, and this way the
// other info pages don't load that stylesheet too.
const info = {
  title: "Track Your Order | KissaPrints", heading: "Track your order", intro: "Enter your order number to see where your keepsake is.",
  description: "Track your KissaPrints order with your order number and email or phone.",
};

export const metadata = pageMeta({ title: info.title, description: info.description, path: "/track-order/" });

export default function TrackOrderPage() {
  return (
    <InfoView slug="track-order" info={info}>
      <div className="page-layout">
        <TrackForm arrow={<Icon name="arrow-right" className="icon--arrow" />} />
        <aside className="aside-card">
          <h2>Good to know</h2>
          <p>Your order number starts with KP- and is on your order confirmation. Orders are printed and dispatched within {site.dispatch}, and the tracking link appears here as soon as yours ships.</p>
          <p>Questions about your order? Call us {site.hours}: <PhoneLinks />.</p>
          <a className="btn btn--ghost" href="/shipping/">Shipping &amp; delivery</a>
        </aside>
      </div>
    </InfoView>
  );
}
