import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/forms";
import { Img } from "@/components/ui";
import { productsBySlug } from "@/lib/catalog";
import { inr, when } from "@/lib/format";
import { settings } from "@/lib/server/config";
import { currentUser } from "@/lib/server/current-user";
import { CUSTOMER_LABELS, wasPaid } from "@/lib/server/orders";
import { makeStore } from "@/lib/server/store";
import { shopVisibility } from "@/lib/server/visibility";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "Your account | KissaPrints", description: "Your KissaPrints orders.", path: "/account/", noindex: true });

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AccountPage({ searchParams }: Props) {
  const viewer = await currentUser(); // proxy.ts already checked the JWT; this also re-checks the database
  if (viewer.state === "expired") redirect("/login/?expired=1&next=/account/");
  if (viewer.state !== "signed-in") redirect("/login/?next=/account/");
  const { user } = viewer;
  const store = makeStore(settings())!;
  // The saved list is a nice-to-have: if it can't load, the page still shows the orders.
  const [all, cart, vis] = await Promise.all([store.listOrders({ userId: user.id, limit: 100 }), store.getCart(user.id).catch(() => null), shopVisibility()]);
  const orders = all.filter(wasPaid).slice(0, 50); // cancelled / unfinished checkouts aren't orders - they stay in the cart
  // Products saved with ♥ (kept on the account); ones switched off in /admin/products/ don't show.
  const saved = (cart?.wishlist ?? []).map((slug) => productsBySlug[slug]).filter((p) => p && vis.product(p.slug));
  const denied = (await searchParams).denied;

  return (
    <div className="wrap account">
      <header className="page-hero">
        <p className="eyebrow">Your account</p>
        <h1>Hi, {user.name.split(" ")[0]}</h1>
        <p className="lead">{user.email}</p>
      </header>
      {denied && <p className="co-error" role="alert">That page is for the KissaPrints team. Ask an admin to give your account access.</p>}
      <div className="account__grid">
        <section className="co-card" aria-labelledby="orders-title">
          <h2 id="orders-title">Your orders</h2>
          {orders.length ? (
            <ul className="account__orders">
              {orders.map((o) => (
                <li key={o.id}>
                  <a href={`/order/?id=${encodeURIComponent(o.id)}&t=${encodeURIComponent(o.token)}`}>
                    <strong>{o.id}</strong><span>{when(o.created_at)} · {o.items.map((l) => l.name).join(", ")}</span>
                    <span className="account__status">{CUSTOMER_LABELS[o.status]}</span><b>{inr(o.total)}</b>
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No orders yet. Orders show up here once they're paid.</p>}
          <a className="btn btn--kiss" href="/shop/">Start creating</a>
        </section>
        <aside className="account__side">
          <section className="co-card" aria-labelledby="saved-title">
            <h2 id="saved-title">Saved for later</h2>
            {saved.length ? (
              <ul className="account__saved">
                {saved.map((p) => (
                  <li key={p.slug}><a href={p.url}><Img name={p.slug} alt="" sizes="56px" w={56} h={56} /><span><strong>{p.name}</strong>from {inr(p.price)}</span></a></li>
                ))}
              </ul>
            ) : <p className="muted">{cart ? "Tap ♥ on any gift to save it here." : "Your saved gifts couldn't load just now - please try again in a minute."}</p>}
          </section>
          <section className="co-card">
          <h2>Account</h2>
          {user.is_admin && <a className="btn btn--block" href="/admin/">Open the order dashboard</a>}
          <LogoutButton>Log out</LogoutButton>
          <LogoutButton everywhere className="link-btn">Log out on every device</LogoutButton>
          <p className="co-hint">Ordered as a guest? Find it with <a href="/track-order/">track order</a>.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
