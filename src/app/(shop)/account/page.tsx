import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/forms";
import { inr, when } from "@/lib/format";
import { settings } from "@/lib/server/config";
import { currentUser } from "@/lib/server/current-user";
import { CUSTOMER_LABELS } from "@/lib/server/orders";
import { makeStore } from "@/lib/server/store";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "Your account | KissaPrints", description: "Your KissaPrints orders.", path: "/account/", noindex: true });

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AccountPage({ searchParams }: Props) {
  const viewer = await currentUser(); // proxy.ts already checked the JWT; this also re-checks the database
  if (viewer.state === "expired") redirect("/login/?expired=1&next=/account/");
  if (viewer.state !== "signed-in") redirect("/login/?next=/account/");
  const { user } = viewer;
  const orders = await makeStore(settings())!.listOrders({ userId: user.id, limit: 50 });
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
          ) : <p className="muted">No orders yet. Orders you place while logged in show up here.</p>}
          <a className="btn btn--kiss" href="/shop/">Start creating</a>
        </section>
        <aside className="co-card">
          <h2>Account</h2>
          {user.is_admin && <a className="btn btn--block" href="/admin/">Open the order dashboard</a>}
          <LogoutButton>Log out</LogoutButton>
          <LogoutButton everywhere className="link-btn">Log out on every device</LogoutButton>
          <p className="co-hint">Ordered as a guest? Find it with <a href="/track-order/">track order</a>.</p>
        </aside>
      </div>
    </div>
  );
}
