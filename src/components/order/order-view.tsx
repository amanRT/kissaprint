"use client";
// The customer's order page (/order/?id=KP-…&t=…): status timeline, missing-photo reminder, tracking link.
import { useEffect, useState } from "react";
import { api, type ApiError } from "@/lib/client-api";
import { inr, phoneDisplay, telHref, when } from "@/lib/format";
import "@/styles/checkout.css";

type View = {
  id: string; status: string; status_label: string; created_at: string; name: string;
  items: { name: string; options: [string, string][]; note: string; qty: number; line_total: number; photos: number; photos_needed: number }[];
  subtotal: number; shipping: number; total: number;
  address: { line1: string; line2: string; city: string; state: string; pincode: string };
  tracking: { courier: string; number: string; url: string } | null; history: { at: string; status: string }[];
};

const STEPS: [string, string][] = [["paid", "Order confirmed"], ["printing", "Being printed"], ["shipped", "Shipped"], ["delivered", "Delivered"]];

export function OrderView({ email, phones, whatsapp, dispatch, checkIcon, clockIcon, arrow }: {
  email: string; phones: string[]; whatsapp: string; dispatch: string; checkIcon: React.ReactNode; clockIcon: React.ReactNode; arrow: React.ReactNode;
}) {
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [order, setOrder] = useState<View | null>(null);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id") || "";
    const token = params.get("t") || "";
    setFresh(params.has("new"));
    if (!id || !token) { setState("missing"); return; } // opened without an order link
    let polls = 0;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const o = await api<View>(`/api/order/?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`);
        setOrder(o);
        setState("ready");
        // Payment confirmations can trail the redirect by a few seconds.
        if (o.status === "pending" && polls++ < 24) timer = setTimeout(load, 5000);
      } catch (err) {
        if ((err as ApiError).status === 404) setState("missing");
        else if (polls++ < 24) timer = setTimeout(load, 5000);
      }
    };
    load();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => { if (order) document.title = `${title(order, fresh)} · ${order.id} | KissaPrints`; }, [order, fresh]);

  if (state === "loading") return <p className="order-loading" data-order-loading>Loading your order…</p>;
  if (state === "missing" || !order) {
    return (
      <div className="order-missing" data-order-missing>
        <h1>We couldn&apos;t find that order</h1>
        <p className="lead">The link may be incomplete. Look it up again with your order number and the email or mobile number you checked out with.</p>
        <a className="btn btn--kiss" href="/track-order/">Track an order {arrow}</a>
      </div>
    );
  }

  const o = order;
  const at = Object.fromEntries(o.history.map((h) => [h.status, h.at]));
  const step = STEPS.findIndex(([s]) => s === o.status);
  const short = o.items.filter((it) => it.photos_needed && it.photos < it.photos_needed);
  const wa = whatsapp.replace(/\D/g, "").replace(/^(?=\d{10}$)/, "91");
  const t = o.tracking;
  const leads: Record<string, string> = {
    pending: "We haven't received your payment yet. If you've just paid, this page will update by itself in a few seconds.",
    paid: `Your order is confirmed. We'll check your photos, print everything and send it out within ${dispatch}.`,
    printing: "Your keepsakes are being printed and packed right now.",
    shipped: "Your order is on its way to you.",
    delivered: "Delivered! We hope it made someone smile.",
    cancelled: "This order was cancelled. If you paid, the refund goes back to your original payment method.",
    refunded: "This order was refunded to your original payment method.",
  };
  const phoneLinks = phones.map((n, i) => <span key={n}>{i > 0 && " or "}<a href={telHref(n)}>{phoneDisplay(n)}</a></span>);

  return (
    <article className="order-view" data-order-view>
      <header className="order-hero">
        <span className={`order-hero__icon order-hero__icon--${o.status}`} aria-hidden="true">{o.status === "pending" ? clockIcon : checkIcon}</span>
        <p className="eyebrow">Order {o.id}</p>
        <h1>{title(o, fresh)}</h1>
        <p className="lead">{leads[o.status]}</p>
      </header>
      {step >= 0 && (
        <ol className="timeline">
          {STEPS.map(([s, label], i) => (
            <li key={s} className={i < step ? "is-done" : i === step ? "is-current" : ""}>
              <span className="timeline__dot" aria-hidden="true" /><strong>{label}</strong>{at[s] && <span>{when(at[s])}</span>}
            </li>
          ))}
        </ol>
      )}
      {short.length > 0 && step >= 0 && step < 2 && (
        <div className="note order-note">
          <strong>We still need some photos.</strong>{" "}
          {short.map((it) => `${it.name}: ${it.photos} of ${it.photos_needed} received.`).join(" ")}{" "}
          Email them to <a href={`mailto:${email}?subject=${encodeURIComponent(`Photos for order ${o.id}`)}`}>{email}</a>
          {wa && <> or <a href={`https://wa.me/${wa}?text=${encodeURIComponent(`Hi! Sending photos for order ${o.id}`)}`} target="_blank" rel="noopener">WhatsApp us</a></>}
          {" "}with your order number <strong>{o.id}</strong>.
        </div>
      )}
      {t && (o.status === "shipped" || o.status === "delivered") && (
        <section className="co-card order-track">
          <h2>Tracking</h2>
          <p>{t.courier ? <>Shipped with <strong>{t.courier}</strong></> : "Shipped"}{t.number && <> · Tracking number <strong>{t.number}</strong></>}</p>
          {t.url && <a className="btn btn--kiss btn--sm" href={t.url} target="_blank" rel="noopener">Track your package</a>}
        </section>
      )}
      <div className="order-grid">
        <section className="co-card">
          <h2>Your order</h2>
          <ul className="co-lines">
            {o.items.map((it, i) => (
              <li className="co-line co-line--text" key={i}>
                <span className="co-line__info"><strong>{it.name} × {it.qty}</strong><span>{it.options.map((x) => x[1]).join(" · ")}</span>{it.note && <span>“{it.note}”</span>}
                  {it.photos_needed > 0 && <span className="co-line__photos">{it.photos} of {it.photos_needed} photos received</span>}</span>
                <span className="co-line__price">{inr(it.line_total)}</span>
              </li>
            ))}
          </ul>
          <dl className="co-totals">
            <div><dt>Subtotal</dt><dd>{inr(o.subtotal)}</dd></div>
            <div><dt>Shipping</dt><dd>{o.shipping ? inr(o.shipping) : "Free"}</dd></div>
            <div className="co-totals__total"><dt>Total</dt><dd>{inr(o.total)}</dd></div>
          </dl>
        </section>
        <aside className="co-card">
          <h2>Delivering to</h2>
          <address>{o.address.line1}<br />{o.address.line2 && <>{o.address.line2}<br /></>}{o.address.city}, {o.address.state} {o.address.pincode}</address>
          <h2>Need help?</h2>
          <p>Call us 24/7 on {phoneLinks}, or email <a href={`mailto:${email}?subject=${encodeURIComponent(`Order ${o.id}`)}`}>{email}</a> with your order number. Bookmark this page to check on your order any time.</p>
        </aside>
      </div>
    </article>
  );
}

function title(o: View, fresh: boolean) {
  return ({ pending: "Waiting for your payment", cancelled: "Order cancelled", refunded: "Order refunded" } as Record<string, string>)[o.status]
    || (fresh && o.status === "paid" ? `Thank you, ${o.name}!` : o.status_label);
}
