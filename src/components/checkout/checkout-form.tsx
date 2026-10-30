"use client";
// Checkout: the server re-prices the cart, the shopper adds contact + address, Razorpay takes payment.
// Razorpay's script (checkout.razorpay.com) loads only on this page, and only once the shopper starts typing.
import { useEffect, useRef, useState } from "react";
import { api, type ApiError } from "@/lib/client-api";
import { inr } from "@/lib/format";
import type { CartItem } from "../shop/provider";

type Line = { slug: string; name: string; options: [string, string][]; note: string; qty: number; line_total: number; photos: number; photos_needed: number };
type QuoteRes = { lines: Line[]; subtotal: number; shipping: number; total: number; free_shipping_over: number; payments: string; test_mode: boolean; test_account?: boolean };
type Placed = { order: { id: string; token: string; total: number }; payment: Record<string, unknown> & { gateway: string } };
type Fields = Record<"name" | "phone" | "email" | "line1" | "line2" | "pincode" | "city" | "state", string>;
type RazorpayCtor = new (options: Record<string, unknown>) => { open(): void; on(event: string, cb: (r: { error?: { description?: string } }) => void): void };

const EMPTY: Fields = { name: "", phone: "", email: "", line1: "", line2: "", pincode: "", city: "", state: "" };
const relogin = () => location.assign("/login/?expired=1&next=%2Fcheckout%2F");
// The cart lives on the shopper's account (nothing is stored in the browser); empty it once the order is placed.
const clearCart = () => api("/api/cart/", { items: [] }, { method: "PUT" }).catch(() => {});
type CartRes = { signedIn: boolean; items: CartItem[]; quote?: QuoteRes; quote_error?: string; prefill: { phone: string; address: { line1: string; line2: string; city: string; state: string; pincode: string } } | null };
const digits = (v: string) => v.replace(/\D/g, "").replace(/^(?:91|0)(?=\d{10}$)/, "");

// Same rules as the server (lib/server/orders.ts), checked here first so mistakes show instantly.
function validate(f: Fields): [keyof Fields, string] | null {
  if (f.name.trim().length < 2) return ["name", "Please enter your full name"];
  if (!/^[6-9]\d{9}$/.test(digits(f.phone))) return ["phone", "Please enter a valid 10-digit mobile number"];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return ["email", "Please enter a valid email address"];
  if (f.line1.trim().length < 3) return ["line1", "Please enter your flat / house number and building"];
  if (!/^[1-9][0-9]{5}$/.test(f.pincode.trim())) return ["pincode", "Please enter a valid 6-digit pincode"];
  if (f.city.trim().length < 2) return ["city", "Please enter your city"];
  if (!f.state) return ["state", "Please choose your state"];
  return null;
}

let razorpayScript: Promise<void> | null = null;
const loadRazorpay = () => (razorpayScript ??= new Promise<void>((resolve, reject) => {
  if ((window as unknown as { Razorpay?: RazorpayCtor }).Razorpay) { resolve(); return; }
  const s = document.createElement("script");
  s.src = "https://checkout.razorpay.com/v1/checkout.js";
  s.onload = () => resolve();
  s.onerror = () => { razorpayScript = null; reject(new Error("Couldn't open the payment window - check your connection and try again")); };
  document.head.append(s);
}));

export function CheckoutForm({ states, dispatch, delivery, icons }: { states: string[]; dispatch: string; delivery: string; icons: Record<"sparkle" | "bag" | "shield", React.ReactNode> }) {
  const [cart, setCart] = useState<CartItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [quote, setQuote] = useState<QuoteRes | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mock, setMock] = useState<Placed | null>(null);
  const placed = useRef<{ key: string; data: Placed } | null>(null); // reused when the shopper retries unchanged
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const mockRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    // Ordering needs an account (proxy.ts sends signed-out shoppers to log in first). Name and email come from it,
    // phone and address from their last order; if the session has ended since, log in again and come straight back.
    api<{ user: { name: string; email: string } | null }>("/api/auth/me/").then(({ user }) => {
      if (!user) relogin();
      else setFields((f) => ({ ...f, name: f.name || user.name, email: f.email || user.email }));
    }).catch(() => {});
    // One request: the cart from the account, priced on the server (no second round trip for the quote).
    api<CartRes>("/api/cart/?quote=1").then(({ signedIn, items, prefill, quote: q, quote_error }) => {
      if (!signedIn) { relogin(); return; }
      setCart(items);
      if (prefill) setFields((f) => ({ ...f, phone: f.phone || prefill.phone, line1: f.line1 || prefill.address.line1, line2: f.line2 || prefill.address.line2,
        city: f.city || prefill.address.city, state: f.state || prefill.address.state, pincode: f.pincode || prefill.address.pincode }));
      if (quote_error) setError({ message: quote_error });
      if (!q) return;
      setQuote(q);
      if (q.payments === "off") setError({ message: "Online payments are being set up, so orders can't be paid just yet." });
    }).catch((err) => {
      if ((err as ApiError).status === 401) relogin();
      else setLoadError((err as Error).message); // never pretend the cart is empty when it just didn't load
    });
  }, []);
  useEffect(() => { if (mock) mockRef.current?.showModal(); }, [mock]);

  const lineItems = (items: CartItem[]) => items.map((c) => ({ slug: c.slug, qty: c.qty, opts: c.opts || {}, note: c.note || "", photos: c.photos || [], ...(c.layout ? { layout: c.layout } : {}) }));
  const payLabel = quote ? `Pay ${inr(quote.total)} securely` : error ? "Pay securely" : "Getting your total…";

  const showError = (message: string, field?: string) => {
    setError({ message, field });
    if (field) (formRef.current?.elements.namedItem(field) as HTMLElement | null)?.focus();
    else requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  const finish = async (order: Placed["order"], response: Record<string, unknown>) => {
    setBusy("Confirming your payment…");
    try {
      await api("verify", { id: order.id, ...response });
    } catch (err) {
      const status = (err as ApiError).status;
      if (status === 400 || status === 409) { setBusy(null); showError((err as Error).message); return; }
      // Network trouble: Razorpay's webhook still confirms the payment, and the order page shows the live status.
    }
    await clearCart();
    location.assign(`/order/?id=${encodeURIComponent(order.id)}&t=${encodeURIComponent(order.token)}&new=1`);
  };
  const cancelled = () => { setBusy(null); showError("Payment cancelled. Your details are saved - try again whenever you're ready."); };

  const razorpay = async (order: Placed["order"], p: Record<string, unknown>) => {
    await loadRazorpay();
    const Ctor = (window as unknown as { Razorpay: RazorpayCtor }).Razorpay;
    const checkout = new Ctor({
      key: p.key, amount: p.amount, currency: p.currency, name: p.name, description: p.description, image: p.image,
      order_id: p.order_id, prefill: p.prefill, notes: p.notes, theme: p.theme,
      handler: (response: Record<string, unknown>) => finish(order, response),
      modal: { ondismiss: cancelled },
    });
    checkout.on("payment.failed", (r) => showError(`Payment didn't go through: ${r.error?.description || "please try another method"}`));
    checkout.open();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !cart || !quote) return;
    const problem = validate(fields);
    if (problem) { showError(problem[1], problem[0]); return; }
    setError(null);
    const t = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim()])) as Fields;
    const body = { items: lineItems(cart), customer: { name: t.name, phone: t.phone, email: t.email },
      address: { line1: t.line1, line2: t.line2, pincode: t.pincode, city: t.city, state: t.state } };
    const key = JSON.stringify(body);
    setBusy("Opening secure payment…");
    try {
      if (!placed.current || placed.current.key !== key) placed.current = { key, data: await api<Placed>("orders", body) };
      const { order, payment } = placed.current.data;
      if (payment.gateway === "bypass") { // team test account: the server skipped payment and saved a test order
        await clearCart();
        location.assign(`/order/?id=${encodeURIComponent(order.id)}&t=${encodeURIComponent(order.token)}&new=1`);
      } else if (payment.gateway === "mock") setMock(placed.current.data);
      else await razorpay(order, payment);
    } catch (err) {
      if ((err as ApiError).status === 401) { relogin(); return; }
      setBusy(null);
      showError((err as Error).message, (err as ApiError).field);
    }
  };

  const set = (name: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFields((f) => ({ ...f, [name]: e.target.value }));
    if (error?.field === name) setError(null);
  };
  const invalid = (name: keyof Fields) => (error?.field === name ? true : undefined);
  const focusOnce = useRef(false);
  const onFocus = () => { if (!focusOnce.current && quote?.payments === "razorpay") { focusOnce.current = true; loadRazorpay().catch(() => {}); } };

  if (loadError) {
    return (
      <div className="co-empty" data-co-load-error role="alert">
        {icons.bag}
        <h2 className="h3">We couldn&apos;t load your cart</h2>
        <p className="muted">{loadError} Your items are safe on your account.</p>
        <button type="button" className="btn btn--kiss" onClick={() => location.reload()}>Try again</button>
      </div>
    );
  }
  if (cart && !cart.length) {
    return (
      <div className="co-empty" data-co-empty>
        {icons.bag}
        <h2 className="h3">Your cart is empty</h2>
        <p className="muted">Add a keepsake or two, then come back here to check out.</p>
        <a className="btn btn--kiss" href="/collections/bestsellers/">Shop bestsellers</a>
      </div>
    );
  }

  return (
    <>
      <p className="test-banner" data-test-banner hidden={!quote?.test_mode && !quote?.test_account}>{icons.sparkle}<span>{quote?.test_account
        ? <><strong>Team test account</strong> - this order skips payment and shows as a Test order in the admin.</>
        : <><strong>Test mode</strong> - no real money is charged.</>}</span></p>
      <div className="co-grid" data-co-grid>
        <form ref={formRef} className="co-form form" data-co-form noValidate onSubmit={submit} onFocus={onFocus}>
          <section className="co-card" aria-labelledby="co-contact">
            <h2 id="co-contact"><span className="co-step" aria-hidden="true">1</span>Contact</h2>
            <label>Full name<input className="input" name="name" autoComplete="name" maxLength={80} required value={fields.name} onChange={set("name")} aria-invalid={invalid("name")} /></label>
            <div className="form-row">
              <label>Mobile number
                <span className="input-prefix"><span aria-hidden="true">+91</span><input className="input" name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={14} placeholder="98765 43210" required aria-describedby="co-contact-hint" value={fields.phone} onChange={set("phone")} aria-invalid={invalid("phone")} /></span>
              </label>
              <label>Email<input className="input" name="email" type="email" autoComplete="email" maxLength={120} required aria-describedby="co-contact-hint" value={fields.email} onChange={set("email")} aria-invalid={invalid("email")} /></label>
            </div>
            <p className="co-hint" id="co-contact-hint">We&apos;ll send order updates to this number and email.</p>
          </section>

          <section className="co-card" aria-labelledby="co-address">
            <h2 id="co-address"><span className="co-step" aria-hidden="true">2</span>Delivery address</h2>
            <label>Flat, house no., building<input className="input" name="line1" autoComplete="address-line1" maxLength={120} required value={fields.line1} onChange={set("line1")} aria-invalid={invalid("line1")} /></label>
            <label>Area, street, landmark <span className="co-optional">(optional)</span><input className="input" name="line2" autoComplete="address-line2" maxLength={120} value={fields.line2} onChange={set("line2")} /></label>
            <div className="form-row form-row--3">
              <label>Pincode<input className="input" name="pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} required value={fields.pincode} onChange={set("pincode")} aria-invalid={invalid("pincode")} /></label>
              <label>City<input className="input" name="city" autoComplete="address-level2" maxLength={60} required value={fields.city} onChange={set("city")} aria-invalid={invalid("city")} /></label>
              <label>State
                <select className="input select" name="state" autoComplete="address-level1" required value={fields.state} onChange={set("state")} aria-invalid={invalid("state")}>
                  <option value="">Choose…</option>
                  {states.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="co-card" aria-labelledby="co-pay">
            <h2 id="co-pay"><span className="co-step" aria-hidden="true">3</span>Payment</h2>
            <p className="co-methods">{icons.shield}<span>UPI, cards, net banking and wallets, processed securely by Razorpay. We never see your card details.</span></p>
            <p ref={errorRef} className="co-error" role="alert" data-co-error hidden={!error}>{error?.message}</p>
            <button className="btn btn--kiss btn--block co-pay" type="submit" data-pay disabled={Boolean(busy) || !quote}>{busy ?? payLabel}</button>
            <p className="co-fine">By placing this order you agree to our <a href="/terms/">terms</a> and <a href="/privacy/">privacy policy</a>. Personalised gifts are made just for you, so they can&apos;t be returned for a change of mind - see <a href="/returns/">returns &amp; reprints</a>.</p>
          </section>
        </form>

        <aside className="co-summary" aria-labelledby="co-sum-title" aria-busy={!quote && !error ? true : undefined}>
          <h2 id="co-sum-title">Order summary</h2>
          <ul className="co-lines" data-co-lines>
            {!quote ? <li className="co-loading">Loading your cart…</li> : quote.lines.map((ln, i) => {
              const image = cart?.[i]?.image;
              const photos = ln.photos_needed ? `${ln.photos} of ${ln.photos_needed} photos added` : ln.photos ? `${ln.photos} photo${ln.photos === 1 ? "" : "s"} added` : "";
              return (
                <li className="co-line" key={i}>
                  <span className="co-line__img">{image && <img src={image} alt="" width={64} height={64} />}<span className="co-line__qty" aria-label={`Quantity ${ln.qty}`}>{ln.qty}</span></span>
                  <span className="co-line__info"><strong>{ln.name}</strong><span>{ln.options.map((o) => o[1]).join(" · ")}</span>{ln.note && <span>“{ln.note}”</span>}{photos && <span className="co-line__photos">{photos}</span>}</span>
                  <span className="co-line__price">{inr(ln.line_total)}</span>
                </li>
              );
            })}
          </ul>
          <dl className="co-totals">
            <div><dt>Subtotal</dt><dd data-co-subtotal>{quote ? inr(quote.subtotal) : "-"}</dd></div>
            <div><dt>Shipping</dt><dd data-co-shipping>{!quote ? "-" : quote.shipping ? <>{inr(quote.shipping)}<small>Free over {inr(quote.free_shipping_over)}</small></> : "Free"}</dd></div>
            <div className="co-totals__total"><dt>Total</dt><dd data-co-total>{quote ? inr(quote.total) : "-"}</dd></div>
          </dl>
          <p className="co-tax">Prices include GST. Dispatched within {dispatch}, delivered in {delivery}.</p>
        </aside>
      </div>

      {mock && (
        // Local development only (no Razorpay keys, not on Vercel): a stand-in for the Razorpay window.
        <dialog ref={mockRef} className="mock-pay" onClose={(e) => {
          const paid = (e.currentTarget as HTMLDialogElement).returnValue === "pay";
          const current = mock;
          setMock(null);
          if (paid) finish(current.order, current.payment.mock as Record<string, unknown>);
          else cancelled();
        }}>
          <form method="dialog" className="mock-pay__panel">
            <p className="eyebrow">Local test payment</p>
            <p className="mock-pay__amount">{inr(Number(mock.payment.amount) / 100)}</p>
            <p>This stands in for Razorpay on your computer, so nothing is charged. Put Razorpay test keys in <code>.env</code> to try the real payment window.</p>
            <div className="mock-pay__actions"><button className="btn btn--kiss" value="pay">Pay successfully</button><button className="btn btn--ghost" value="cancel">Cancel</button></div>
          </form>
        </dialog>
      )}
    </>
  );
}
