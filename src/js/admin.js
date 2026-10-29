/* KissaPrints admin (/admin/): sign in, watch orders arrive, update status + tracking, download an order's photos as one zip. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const ago = (iso) => {
    const min = Math.round((Date.now() - new Date(iso)) / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
    return when(iso);
  };
  const phone = (p) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
  const STATUS = { pending: "Unpaid", paid: "New", printing: "Printing", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled", refunded: "Refunded" };
  const HINTS = {
    new: "Paid and waiting to be printed - oldest first, so nobody waits too long.",
    printing: "In production, oldest first. Add the courier and tracking number when you ship.",
    shipped: "On the way to the customer.",
    delivered: "Done and dusted.",
    unpaid: "Checkouts where the payment didn't complete. A friendly WhatsApp sometimes rescues these.",
    closed: "Cancelled or refunded orders. Refunds themselves are made in the Razorpay dashboard.",
    all: "Every order, newest first.",
  };

  let signedIn = false;
  const api = async (route, { body, query } = {}) => {
    const qs = query ? `?${new URLSearchParams(query)}` : "";
    const res = await fetch(`/api/admin/${route}/${qs}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && route !== "login") { showLogin(); }
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong"), { status: res.status, field: data.field });
    return data;
  };

  /* Toast: lives inside an open dialog when there is one (modal dialogs cover everything else). */
  const toast = $("[data-toast]");
  let toastTimer;
  const say = (message) => {
    ($("dialog[open]") || document.body).append(toast);
    $("[data-toast-msg]", toast).textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  };

  /* ---------- Sign in ---------- */
  const loginView = $("[data-login]");
  const dash = $("[data-dash]");
  const loginForm = $("[data-login-form]");
  const showLogin = () => {
    signedIn = false;
    dash.hidden = true;
    loginView.hidden = false;
    $("[data-signed-in]").hidden = true;
    $("[data-detail]").open && $("[data-detail]").close();
    loginForm.elements.namedItem("password").focus();
  };
  const showDash = (me) => {
    signedIn = true;
    loginView.hidden = true;
    dash.hidden = false;
    $("[data-signed-in]").hidden = false;
    const mode = $("[data-mode]");
    const label = me.payments === "mock" ? "Local test mode" : me.payments === "off" ? "Payments not set up" : me.test_mode ? "Razorpay test mode" : "";
    mode.textContent = label + (me.payments === "razorpay" && !me.webhook ? " · webhook not set" : "");
    mode.hidden = !mode.textContent;
    const setup = $("[data-setup]");
    const problems = me.problems || [];
    setup.innerHTML = problems.length ? `<strong>Setup needs attention:</strong><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
    setup.hidden = !problems.length;
    load();
  };
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = $("[data-login-error]");
    const button = $("button", loginForm);
    button.disabled = true;
    error.hidden = true;
    try {
      await api("login", { body: { password: loginForm.elements.namedItem("password").value } });
      loginForm.reset();
      const me = await api("me");
      if (me.signed_in) showDash(me);
      else throw new Error("Signed in, but the session cookie didn't stick - are cookies blocked?");
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
    button.disabled = false;
  });
  $("[data-logout]").addEventListener("click", async () => { await api("logout", { body: {} }).catch(() => {}); showLogin(); });

  /* ---------- Order list ---------- */
  const list = $("[data-list]");
  const tabs = $$("[data-tab]");
  let tab = "new";
  let query = "";
  let loading = false;
  let latest = null; // newest updated_at the dashboard has shown
  let paidWaiting = null; // "New" count at the last load, to spot freshly paid orders

  /* A short two-note chime for new paid orders. Browsers only allow sound after a click on the page. */
  let audio;
  document.addEventListener("click", () => {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* no audio */ }
  }, { once: true });
  const chime = () => {
    if (!audio || audio.state !== "running") return;
    const t = audio.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.2, t + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.5);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + i * 0.18);
      osc.stop(t + i * 0.18 + 0.55);
    });
  };

  const load = async (quiet) => {
    if (!signedIn || loading) return;
    loading = true;
    if (!quiet) {
      list.setAttribute("aria-busy", "true");
      $("[data-tab-hint]").textContent = HINTS[tab];
      list.innerHTML = '<p class="adm-empty">Loading orders…</p>';
    }
    try {
      const data = await api("orders", { query: { tab, q: query } });
      Object.entries(data.counts).forEach(([key, n]) => { const el = $(`[data-count="${key}"]`); if (el) el.textContent = n; });
      document.title = `${data.counts.new ? `(${data.counts.new}) ` : ""}Orders | KissaPrints admin`;
      $("[data-tab-hint]").textContent = HINTS[tab];
      latest = data.latest;
      if (paidWaiting !== null && data.counts.new > paidWaiting) {
        const n = data.counts.new - paidWaiting;
        say(n === 1 ? "New paid order - it's in the New tab" : `${n} new paid orders - they're in the New tab`);
        chime();
      }
      paidWaiting = data.counts.new;
      const updated = $("[data-updated]");
      updated.textContent = `Live · updated ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
      updated.hidden = false;
      list.innerHTML = data.orders.length ? data.orders.map((o) => {
        const short = o.photos_needed && o.photos < o.photos_needed;
        const fresh = Date.now() - new Date(o.created_at) < 3600000;
        return `<button class="adm-row" type="button" data-order="${esc(o.id)}">
          <span class="adm-row__top"><strong>${esc(o.id)}</strong><span class="adm-status adm-status--${esc(o.status)}">${STATUS[o.status]}</span>${o.test ? '<span class="adm-test" title="Test payment - no real money">Test</span>' : ""}${fresh ? '<span class="adm-dot" title="Placed in the last hour"></span>' : ""}<span class="adm-row__total">${inr(o.total)}</span></span>
          <span class="adm-row__who">${esc(o.name)} · ${esc(o.city)}, ${esc(o.state)}</span>
          <span class="adm-row__items">${esc(o.items.join(", "))}</span>
          <span class="adm-row__meta"><span>${ago(o.created_at)}</span>${o.photos_needed || o.photos ? `<span class="${short ? "adm-warn" : ""}">${o.photos}${o.photos_needed ? ` / ${o.photos_needed}` : ""} photos</span>` : ""}</span>
        </button>`;
      }).join("") : `<p class="adm-empty">${query ? "No orders match that search." : "Nothing here right now."}${!query && tab !== "all" && data.counts.all
        ? ` <button class="link-btn" type="button" data-show-all>See all ${data.counts.all} order${data.counts.all === 1 ? "" : "s"}</button>` : ""}</p>`;
    } catch (err) {
      if (err.status !== 401) list.innerHTML = `<p class="co-error">${esc(err.message)}</p>`;
    }
    list.removeAttribute("aria-busy");
    loading = false;
  };
  const selectTab = (btn) => {
    tabs.forEach((t) => { const on = t === btn; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
    list.setAttribute("aria-labelledby", btn.id);
    tab = btn.dataset.tab;
    load();
  };
  tabs.forEach((btn) => btn.addEventListener("click", () => selectTab(btn)));
  $("[data-tabs]").addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0 || !["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    selectTab(next);
  });
  let searchTimer;
  $("[data-search]").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = e.target.value.trim(); load(); }, 300);
  });
  $("[data-refresh]").addEventListener("click", () => load());
  list.addEventListener("click", (e) => {
    const row = e.target.closest("[data-order]");
    if (row) openOrder(row.dataset.order);
    if (e.target.closest("[data-show-all]")) selectTab(tabs.find((t) => t.dataset.tab === "all"));
  });
  // No refresh button needed: every 30 s ask the server for the newest change (one tiny row) and reload
  // the list only when something changed. Keeps running in a background tab, so the chime still plays.
  const POLL_MS = 30000;
  const poll = async () => {
    if (!signedIn || loading) return;
    try {
      const { latest: now } = await api("changes");
      if (now !== latest) await load(true);
      else $("[data-updated]").textContent = `Live · checked ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
    } catch { /* offline for a moment - the next check retries */ }
  };
  setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(); });

  /* ---------- Order detail ---------- */
  const detail = $("[data-detail]");
  const detailBody = $("[data-detail-body]");
  detail.addEventListener("click", (e) => { if (e.target === detail || e.target.closest("[data-close]")) detail.close(); });
  detail.addEventListener("close", () => load(true));
  let current = null;

  const openOrder = async (id) => {
    $("[data-detail-title]").textContent = id;
    detailBody.innerHTML = '<p class="muted">Loading…</p>';
    if (!detail.open) detail.showModal();
    try {
      const data = await api("order", { query: { id } });
      current = data;
      renderDetail(data.order, data.photos);
    } catch (err) {
      detailBody.innerHTML = `<p class="co-error">${esc(err.message)}</p>`;
    }
  };

  const addressText = (o) => {
    const a = o.address;
    return [o.customer.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.pincode}`, phone(o.customer.phone)].filter(Boolean).join("\n");
  };

  const renderDetail = (o, photos) => {
    const c = o.customer;
    const t = o.tracking || {};
    const pay = o.payment || {};
    const totalPhotos = o.items.reduce((n, it) => n + it.photos.length, 0);
    const options = Object.keys(STATUS).filter((s) => s !== "pending" || o.status === "pending")
      .map((s) => `<option value="${s}"${s === o.status ? " selected" : ""}>${s === "paid" ? "New - paid, to print" : STATUS[s]}</option>`).join("");
    const test = ["mock", "razorpay_test", "bypass"].includes(o.gateway);
    const how = { mock: "paid with the local test payment window", razorpay_test: "paid with Razorpay test keys", bypass: "placed with a team test number, so payment was skipped" }[o.gateway];
    detailBody.innerHTML = `
      <div class="adm-sum"><span class="adm-status adm-status--${esc(o.status)}">${STATUS[o.status]}</span>${test ? '<span class="adm-test">Test</span>' : ""}<span>Placed ${when(o.created_at)}</span><strong>${inr(o.total)}</strong></div>
      ${test ? `<div class="adm-test-note"><p><strong>Test order:</strong> ${how}. No real money moved, so don't print or ship it.</p>
        <button class="btn btn--ghost btn--sm" type="button" data-delete>Delete test order</button></div>` : ""}
      <section class="adm-card"><h3>Customer</h3>
        <p><strong>${esc(c.name)}</strong></p>
        <p><a href="tel:+91${esc(c.phone)}">${phone(c.phone)}</a> · <a href="https://wa.me/91${esc(c.phone)}" target="_blank" rel="noopener">WhatsApp</a></p>
        <p><a href="mailto:${esc(c.email)}?subject=${encodeURIComponent(`Your KissaPrints order ${o.id}`)}">${esc(c.email)}</a></p></section>
      <section class="adm-card"><h3>Ship to <button class="link-btn" type="button" data-copy>Copy address</button></h3>
        <address>${esc(addressText(o)).replace(/\n/g, "<br>")}</address></section>
      <section class="adm-card"><h3>Items${totalPhotos ? ` <button class="btn btn--ghost btn--sm" type="button" data-zip>Download ${totalPhotos} photo${totalPhotos === 1 ? "" : "s"} (.zip)</button>` : ""}</h3>
        ${o.items.map((it) => `<div class="adm-item">
          <div class="adm-item__head"><strong>${esc(it.name)} × ${it.qty}</strong><span>${inr(it.line_total)}</span></div>
          <p>${it.options.map(([k, v]) => `${esc(k)}: <strong>${esc(v)}</strong>`).join(" · ")}</p>
          ${it.note ? `<p>Caption: <strong>“${esc(it.note)}”</strong></p>` : ""}
          ${it.photos_needed || it.photos.length ? `<p class="${it.photos.length < it.photos_needed ? "adm-warn" : "adm-ok"}">${it.photos.length}${it.photos_needed ? ` of ${it.photos_needed}` : ""} photos uploaded${it.photos.length < it.photos_needed ? " - ask the customer for the rest" : ""}</p>` : ""}
          ${it.photos.length ? `<div class="adm-photos">${it.photos.map((ph) => photos[ph.key]
            ? `<a href="${esc(photos[ph.key])}" target="_blank" rel="noopener" title="${esc(ph.name)}"><img src="${esc(photos[ph.key])}" alt="${esc(ph.name)}" loading="lazy"></a>`
            : `<span class="adm-photo-missing" title="${esc(ph.name)}">missing</span>`).join("")}</div>` : ""}
        </div>`).join("")}
        <dl class="co-totals"><div><dt>Subtotal</dt><dd>${inr(o.subtotal)}</dd></div><div><dt>Shipping</dt><dd>${o.shipping ? inr(o.shipping) : "Free"}</dd></div><div class="co-totals__total"><dt>Total</dt><dd>${inr(o.total)}</dd></div></dl></section>
      <section class="adm-card"><h3>Payment</h3>
        ${o.razorpay_payment_id ? `<p>${esc(pay.method ? pay.method.toUpperCase() : "Paid")}${pay.vpa ? ` · ${esc(pay.vpa)}` : ""}${pay.card ? ` · ${esc(pay.card.network || "")} ${esc(pay.card.last4 ? "•••• " + pay.card.last4 : "")}` : ""}</p>
          <p class="adm-mono">${esc(o.razorpay_payment_id)}</p>
          ${o.gateway === "mock" ? "<p class=\"muted\">Local test payment</p>" : `<p><a href="https://dashboard.razorpay.com/app/payments/${encodeURIComponent(o.razorpay_payment_id)}" target="_blank" rel="noopener">Open in Razorpay${o.gateway === "razorpay_test" ? " (test mode)" : ""} ↗</a></p>`}`
          : o.gateway === "bypass" ? "<p class=\"muted\">Payment skipped - team test number.</p>"
          : `<p class="adm-warn">Not paid yet.</p><p class="adm-mono">${esc(o.razorpay_order_id || "")}</p>`}</section>
      <form class="adm-card form" data-update novalidate><h3>Update order</h3>
        <label>Status<select class="input select" name="status">${options}</select></label>
        <div class="form-row"><label>Courier<input class="input" name="courier" value="${esc(t.courier || "")}" placeholder="Delhivery, Shiprocket…"></label>
          <label>Tracking number<input class="input" name="number" value="${esc(t.number || "")}"></label></div>
        <label>Tracking link<input class="input" name="url" type="url" value="${esc(t.url || "")}" placeholder="https://"></label>
        <label>Note for the customer's timeline <span class="co-optional">(optional)</span><input class="input" name="note" maxlength="280"></label>
        <label>Internal notes <span class="co-optional">(only the team sees these)</span><textarea class="input" name="notes" rows="3" maxlength="4000">${esc(o.notes || "")}</textarea></label>
        <p class="co-error" data-update-error hidden></p>
        <button class="btn btn--kiss" type="submit">Save changes</button>
        <p class="adm-fine">Customers see the status and tracking on their order page. Make refunds in the Razorpay dashboard, then set the status to Refunded.</p></form>
      <section class="adm-card"><h3>History</h3><ol class="adm-history">${o.history.slice().reverse().map((h) => `<li><strong>${STATUS[h.status]}</strong> · ${when(h.at)}${h.note ? `<br><span>${esc(h.note)}</span>` : ""}</li>`).join("")}</ol>
        <p><a href="/order/?id=${encodeURIComponent(o.id)}&t=${encodeURIComponent(o.token)}" target="_blank" rel="noopener">Open the customer's order page ↗</a></p></section>`;
  };

  detailBody.addEventListener("click", async (e) => {
    if (!current) return;
    if (e.target.closest("[data-copy]")) {
      try { await navigator.clipboard.writeText(addressText(current.order)); say("Address copied"); } catch { say("Couldn't copy - select the address instead"); }
    }
    const zipBtn = e.target.closest("[data-zip]");
    if (zipBtn) downloadPhotos(current.order, current.photos, zipBtn);
    const del = e.target.closest("[data-delete]");
    if (del && window.confirm(`Delete test order ${current.order.id} and its photos? This can't be undone.`)) {
      del.disabled = true;
      try {
        await api("delete", { body: { id: current.order.id } });
        detail.close();
        say(`Test order ${current.order.id} deleted`);
      } catch (err) {
        say(err.message);
        del.disabled = false;
      }
    }
  });
  detailBody.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-update]");
    if (!form || !current) return;
    e.preventDefault();
    const f = (n) => form.elements.namedItem(n).value.trim();
    const error = $("[data-update-error]", form);
    const button = $("button[type=submit]", form);
    error.hidden = true;
    button.disabled = true;
    try {
      const { order } = await api("order", { body: {
        id: current.order.id, status: f("status"), note: f("note"), notes: form.elements.namedItem("notes").value,
        tracking: { courier: f("courier"), number: f("number"), url: f("url") },
      } });
      current.order = order;
      renderDetail(order, current.photos);
      say("Saved");
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });

  /* ---------- Photos -> one .zip (stored, not compressed: the photos are JPEGs already) ---------- */
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (bytes) => { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const zip = (files) => {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach(({ name, data }) => {
      const nameBytes = enc.encode(name);
      const crc = crc32(data);
      const head = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nameBytes.length, 2], [28, 0, 2]]
        .forEach(([at, v, size]) => (size === 4 ? head.setUint32(at, v, true) : head.setUint16(at, v, true)));
      const dir = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nameBytes.length, 2], [42, offset, 4]]
        .forEach(([at, v, size]) => (size === 4 ? dir.setUint32(at, v, true) : dir.setUint16(at, v, true)));
      parts.push(head, nameBytes, data);
      central.push(dir, nameBytes);
      offset += 30 + nameBytes.length + data.length;
    });
    const size = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4]]
      .forEach(([at, v, s]) => (s === 4 ? end.setUint32(at, v, true) : end.setUint16(at, v, true)));
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  };

  const downloadPhotos = async (order, photos, button) => {
    const label = button.textContent;
    const jobs = order.items.flatMap((it, i) => it.photos.map((ph, j) => ({ it, i, j, ph })));
    const files = [];
    button.disabled = true;
    try {
      for (const [n, { it, i, j, ph }] of jobs.entries()) {
        button.textContent = `Downloading ${n + 1} of ${jobs.length}…`;
        if (!photos[ph.key]) continue;
        const res = await fetch(photos[ph.key]);
        if (!res.ok) throw new Error(`Couldn't download ${ph.name}`);
        const ext = ph.key.split(".").pop();
        const base = ph.name.replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "_").slice(0, 60) || "photo";
        files.push({ name: `${order.id}/${String(i + 1).padStart(2, "0")}-${it.slug}/${String(j + 1).padStart(3, "0")}-${base}.${ext}`, data: new Uint8Array(await res.arrayBuffer()) });
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zip(files));
      a.download = `${order.id}-photos.zip`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      say(`${files.length} photos zipped`);
    } catch (err) {
      say(err.message);
    }
    button.textContent = label;
    button.disabled = false;
  };

  /* ---------- Start ---------- */
  api("me").then((me) => (me.signed_in ? showDash(me) : showLogin())).catch(showLogin);
})();
