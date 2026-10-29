/* KissaPrints checkout: the server re-prices the cart, the shopper adds contact + address, Razorpay takes payment.
   Only this page loads Razorpay's script (from checkout.razorpay.com), and only once the shopper starts filling in the form. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };
  const api = async (route, body) => {
    const res = await fetch(`/api/${route}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong - please try again"), { status: res.status, field: data.field });
    return data;
  };

  const page = $("[data-co-page]");
  if (!page) return;
  const form = $("[data-co-form]", page);
  const payBtn = $("[data-pay]", page);
  const errorBox = $("[data-co-error]", page);
  const field = (name) => form.elements.namedItem(name);
  const value = (name) => field(name).value.trim();
  const cart = read("kp-cart2", []);
  let quote = null;
  let placed = null; // {key, data}: reused when the shopper retries without changing anything

  const items = () => cart.map((c) => ({ slug: c.slug, qty: c.qty, opts: c.opts || {}, note: c.note || "", photos: c.photos || [] }));
  const payLabel = () => (quote ? `Pay ${inr(quote.total)} securely` : "Pay securely");

  const showError = (message, name) => {
    errorBox.textContent = message || "";
    errorBox.hidden = !message;
    $$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
    const input = name && field(name);
    if (input) {
      input.setAttribute("aria-invalid", "true");
      input.focus();
    } else if (message) {
      errorBox.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };
  const busy = (on, label) => {
    payBtn.disabled = on;
    payBtn.textContent = on ? label : payLabel();
    form.classList.toggle("is-busy", on);
  };

  const renderSummary = (q) => {
    $("[data-co-lines]", page).innerHTML = q.lines.map((ln, i) => {
      const image = cart[i] && cart[i].image;
      const photos = ln.photos_needed ? `${ln.photos} of ${ln.photos_needed} photos added` : ln.photos ? `${ln.photos} photo${ln.photos === 1 ? "" : "s"} added` : "";
      return `<li class="co-line">
        <span class="co-line__img">${image ? `<img src="${esc(image)}" alt="" width="64" height="64">` : ""}<span class="co-line__qty" aria-label="Quantity ${ln.qty}">${ln.qty}</span></span>
        <span class="co-line__info"><strong>${esc(ln.name)}</strong><span>${esc(ln.options.map((o) => o[1]).join(" · "))}</span>${ln.note ? `<span>“${esc(ln.note)}”</span>` : ""}${photos ? `<span class="co-line__photos">${esc(photos)}</span>` : ""}</span>
        <span class="co-line__price">${inr(ln.line_total)}</span></li>`;
    }).join("");
    $("[data-co-subtotal]", page).textContent = inr(q.subtotal);
    $("[data-co-shipping]", page).innerHTML = q.shipping
      ? `${inr(q.shipping)}<small>Free over ${inr(q.free_shipping_over)}</small>` : "Free";
    $("[data-co-total]", page).textContent = inr(q.total);
    payBtn.textContent = payLabel();
  };

  let razorpayScript = null;
  const loadRazorpay = () => razorpayScript || (razorpayScript = new Promise((resolve, reject) => {
    if (window.Razorpay) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = () => { razorpayScript = null; reject(new Error("Couldn't open the payment window - check your connection and try again")); };
    document.head.append(s);
  }));

  // Same rules as the server (backend/orders.py), checked here first so mistakes show instantly.
  const digits = (v) => v.replace(/\D/g, "").replace(/^(?:91|0)(?=\d{10}$)/, "");
  const validate = () => {
    if (value("name").length < 2) return ["name", "Please enter your full name"];
    if (!/^[6-9]\d{9}$/.test(digits(value("phone")))) return ["phone", "Please enter a valid 10-digit mobile number"];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value("email"))) return ["email", "Please enter a valid email address"];
    if (value("line1").length < 3) return ["line1", "Please enter your flat / house number and building"];
    if (!/^[1-9][0-9]{5}$/.test(value("pincode"))) return ["pincode", "Please enter a valid 6-digit pincode"];
    if (value("city").length < 2) return ["city", "Please enter your city"];
    if (!value("state")) return ["state", "Please choose your state"];
    return null;
  };

  const finish = async (order, response) => {
    busy(true, "Confirming your payment…");
    try {
      await api("verify", { id: order.id, ...response });
    } catch (err) {
      if (err.status === 400 || err.status === 409) { busy(false); showError(err.message); return; }
      // Network trouble: Razorpay's webhook still confirms the payment, and the order page shows the live status.
    }
    localStorage.removeItem("kp-cart2");
    location.assign(`/order/?id=${encodeURIComponent(order.id)}&t=${encodeURIComponent(order.token)}&new=1`);
  };
  const cancelled = () => { busy(false); showError("Payment cancelled. Your details are saved - try again whenever you're ready."); };

  const razorpay = async (order, p) => {
    await loadRazorpay();
    const checkout = new window.Razorpay({
      key: p.key, amount: p.amount, currency: p.currency, name: p.name, description: p.description, image: p.image,
      order_id: p.order_id, prefill: p.prefill, notes: p.notes, theme: p.theme,
      handler: (response) => finish(order, response),
      modal: { ondismiss: cancelled },
    });
    checkout.on("payment.failed", (r) => showError(`Payment didn't go through: ${(r.error && r.error.description) || "please try another method"}`));
    checkout.open();
  };

  // Local development only (no Razorpay keys, not on Vercel): a stand-in for the Razorpay window.
  const mockPay = (order, p) => {
    const dialog = document.createElement("dialog");
    dialog.className = "mock-pay";
    dialog.innerHTML = `<form method="dialog" class="mock-pay__panel">
      <p class="eyebrow">Local test payment</p>
      <p class="mock-pay__amount">${inr(p.amount / 100)}</p>
      <p>This stands in for Razorpay on your computer, so nothing is charged. Put Razorpay test keys in <code>.env</code> to try the real payment window.</p>
      <div class="mock-pay__actions"><button class="btn btn--kiss" value="pay">Pay successfully</button><button class="btn btn--ghost" value="cancel">Cancel</button></div>
    </form>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      const paid = dialog.returnValue === "pay";
      dialog.remove();
      if (paid) finish(order, p.mock);
      else cancelled();
    });
    dialog.showModal();
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (payBtn.disabled) return;
    const problem = validate();
    if (problem) { showError(problem[1], problem[0]); return; }
    showError("");
    const customer = { name: value("name"), phone: value("phone"), email: value("email") };
    const address = { line1: value("line1"), line2: value("line2"), pincode: value("pincode"), city: value("city"), state: value("state") };
    write("kp-checkout", { ...customer, ...address });
    const body = { items: items(), customer, address };
    const key = JSON.stringify(body);
    busy(true, "Opening secure payment…");
    try {
      if (!placed || placed.key !== key) placed = { key, data: await api("orders", body) };
      const { order, payment } = placed.data;
      if (payment.gateway === "bypass") { // team test number: the server skipped payment and saved a test order
        localStorage.removeItem("kp-cart2");
        location.assign(`/order/?id=${encodeURIComponent(order.id)}&t=${encodeURIComponent(order.token)}&new=1`);
      } else if (payment.gateway === "mock") mockPay(order, payment);
      else await razorpay(order, payment);
    } catch (err) {
      busy(false);
      showError(err.message, err.field);
    }
  });
  form.addEventListener("input", (e) => { if (e.target.getAttribute("aria-invalid")) e.target.removeAttribute("aria-invalid"); });

  (async () => {
    if (!cart.length) {
      $("[data-co-grid]", page).hidden = true;
      $("[data-co-empty]", page).hidden = false;
      return;
    }
    const saved = read("kp-checkout", {});
    Object.entries(saved).forEach(([name, v]) => { const input = field(name); if (input && typeof v === "string" && !input.value) input.value = v; });
    try {
      quote = await api("quote", { items: items() });
    } catch (err) {
      $("[data-co-lines]", page).innerHTML = "";
      showError(err.message);
      return;
    }
    renderSummary(quote);
    $("[data-test-banner]", page).hidden = !quote.test_mode;
    payBtn.disabled = false; // even with payments off: the server still accepts the team's test numbers
    if (quote.payments === "off") {
      errorBox.textContent = "Online payments are being set up, so orders can't be paid just yet.";
      errorBox.hidden = false;
    }
    if (quote.payments === "razorpay") form.addEventListener("focusin", () => loadRazorpay().catch(() => {}), { once: true });
  })();
})();
