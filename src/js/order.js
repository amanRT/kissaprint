/* The customer's order page (/order/?id=KP-…&t=…) and the track-order form that leads to it. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const request = async (path, body) => {
    const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong - please try again"), { status: res.status });
    return data;
  };
  const orderLink = (id, token) => `/order/?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`;

  /* ---------- Track order ---------- */
  const track = $("[data-track-form]");
  if (track) {
    const error = $("[data-track-error]", track);
    const button = $("button[type=submit]", track);
    track.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = track.elements.namedItem("id").value.trim();
      const contact = track.elements.namedItem("contact").value.trim();
      error.hidden = true;
      if (!id || !contact) {
        error.textContent = "Please enter your order number and the email or mobile number you checked out with.";
        error.hidden = false;
        return;
      }
      button.disabled = true;
      try {
        const found = await request("/api/track/", { id, contact });
        location.assign(orderLink(found.id, found.token));
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        button.disabled = false;
      }
    });
  }

  /* ---------- Order page ---------- */
  const page = $("[data-order-page]");
  if (!page) return;
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || "";
  const token = params.get("t") || "";
  const view = $("[data-order-view]", page);
  const STEPS = [["paid", "Order confirmed"], ["printing", "Being printed"], ["shipped", "Shipped"], ["delivered", "Delivered"]];
  const LEADS = {
    pending: "We haven't received your payment yet. If you've just paid, this page will update by itself in a few seconds.",
    paid: `Your order is confirmed. We'll check your photos, print everything and send it out within ${page.dataset.dispatch}.`,
    printing: "Your keepsakes are being printed and packed right now.",
    shipped: "Your order is on its way to you.",
    delivered: "Delivered! We hope it made someone smile.",
    cancelled: "This order was cancelled. If you paid, the refund goes back to your original payment method.",
    refunded: "This order was refunded to your original payment method.",
  };
  // Store an Indian WhatsApp number as 10 digits (or with 91); wa.me needs the country code.
  const whatsapp = (page.dataset.whatsapp || "").replace(/\D/g, "").replace(/^(?=\d{10}$)/, "91");
  const sendPhotosHelp = (orderId) => {
    const mail = `<a href="mailto:${esc(page.dataset.email)}?subject=${encodeURIComponent(`Photos for order ${orderId}`)}">${esc(page.dataset.email)}</a>`;
    const wa = whatsapp ? ` or <a href="https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hi! Sending photos for order ${orderId}`)}" target="_blank" rel="noopener">WhatsApp us</a>` : "";
    return `Email them to ${mail}${wa} with your order number <strong>${esc(orderId)}</strong>.`;
  };

  const render = (o) => {
    const fresh = params.has("new") && o.status === "paid";
    const title = { pending: "Waiting for your payment", cancelled: "Order cancelled", refunded: "Order refunded" }[o.status]
      || (fresh ? `Thank you, ${o.name}!` : o.status_label);
    const at = Object.fromEntries(o.history.map((h) => [h.status, h.at]));
    const step = STEPS.findIndex(([s]) => s === o.status);
    const timeline = step < 0 ? "" : `<ol class="timeline">${STEPS.map(([s, label], i) => `<li class="${i < step ? "is-done" : i === step ? "is-current" : ""}">
      <span class="timeline__dot" aria-hidden="true"></span><strong>${label}</strong>${at[s] ? `<span>${when(at[s])}</span>` : ""}</li>`).join("")}</ol>`;
    const short = o.items.filter((it) => it.photos_needed && it.photos < it.photos_needed);
    const photoNote = short.length && step >= 0 && step < 2
      ? `<div class="note order-note"><strong>We still need some photos.</strong> ${short.map((it) => `${esc(it.name)}: ${it.photos} of ${it.photos_needed} received.`).join(" ")} ${sendPhotosHelp(o.id)}</div>` : "";
    const t = o.tracking;
    const tracking = t && (o.status === "shipped" || o.status === "delivered") ? `<section class="co-card order-track"><h2>Tracking</h2>
      <p>${t.courier ? `Shipped with <strong>${esc(t.courier)}</strong>` : "Shipped"}${t.number ? ` · Tracking number <strong>${esc(t.number)}</strong>` : ""}</p>
      ${t.url ? `<a class="btn btn--kiss btn--sm" href="${esc(t.url)}" target="_blank" rel="noopener">Track your package</a>` : ""}</section>` : "";
    const a = o.address;
    view.innerHTML = `<header class="order-hero">
        <span class="order-hero__icon order-hero__icon--${esc(o.status)}" aria-hidden="true"><svg class="icon"><use href="#i-${o.status === "pending" ? "clock" : "check"}"/></svg></span>
        <p class="eyebrow">Order ${esc(o.id)}</p>
        <h1>${esc(title)}</h1>
        <p class="lead">${LEADS[o.status]}</p>
      </header>
      ${timeline}${photoNote}${tracking}
      <div class="order-grid">
        <section class="co-card"><h2>Your order</h2><ul class="co-lines">${o.items.map((it) => `<li class="co-line co-line--text">
          <span class="co-line__info"><strong>${esc(it.name)} × ${it.qty}</strong><span>${esc(it.options.map((x) => x[1]).join(" · "))}</span>${it.note ? `<span>“${esc(it.note)}”</span>` : ""}${it.photos_needed ? `<span class="co-line__photos">${it.photos} of ${it.photos_needed} photos received</span>` : ""}</span>
          <span class="co-line__price">${inr(it.line_total)}</span></li>`).join("")}</ul>
          <dl class="co-totals"><div><dt>Subtotal</dt><dd>${inr(o.subtotal)}</dd></div><div><dt>Shipping</dt><dd>${o.shipping ? inr(o.shipping) : "Free"}</dd></div>
          <div class="co-totals__total"><dt>Total</dt><dd>${inr(o.total)}</dd></div></dl></section>
        <aside class="co-card"><h2>Delivering to</h2><address>${esc(a.line1)}<br>${a.line2 ? `${esc(a.line2)}<br>` : ""}${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}</address>
          <h2>Need help?</h2><p>Email <a href="mailto:${esc(page.dataset.email)}?subject=${encodeURIComponent(`Order ${o.id}`)}">${esc(page.dataset.email)}</a> with your order number. Bookmark this page to check on your order any time.</p></aside>
      </div>`;
    view.hidden = false;
    document.title = `${title} · ${o.id} | KissaPrints`;
  };

  if (!id || !token) { // opened without an order link
    $("[data-order-loading]", page).hidden = true;
    $("[data-order-missing]", page).hidden = false;
    return;
  }
  let polls = 0;
  const load = async () => {
    try {
      const order = await request(`/api/order/?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`);
      $("[data-order-loading]", page).hidden = true;
      render(order);
      // Payment confirmations can trail the redirect by a few seconds.
      if (order.status === "pending" && polls++ < 24) setTimeout(load, 5000);
    } catch (err) {
      $("[data-order-loading]", page).hidden = true;
      if (err.status === 404 || !id) $("[data-order-missing]", page).hidden = false;
      else if (polls++ < 24) setTimeout(load, 5000);
    }
  };
  load();
})();
