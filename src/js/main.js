/* KissaPrints - progressive enhancement. Pages work without JS; this adds cart, search, previews and polish. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const inr = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  };
  const root = document.documentElement;
  const FREE_SHIP = Number(root.dataset.freeShip) || 699;
  const api = async (route, body) => {
    const res = await fetch(`/api/${route}/`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong - please try again"), { status: res.status });
    return data;
  };

  /* ---------- Header: elevate once the offer bar scrolls away ----------
     IntersectionObserver instead of reading scrollY: no forced layout at startup. */
  const header = $("[data-header]");
  const offerBar = $(".announce");
  if (header && offerBar && "IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => header.classList.toggle("is-stuck", !entry.isIntersecting)).observe(offerBar);
  }

  /* ---------- Mega menus (click / keyboard; hover handled in CSS) ---------- */
  const megas = $$("[data-mega]");
  const closeMega = (item) => { item.classList.remove("is-open"); $("button", item).setAttribute("aria-expanded", "false"); };
  megas.forEach((item) => {
    const btn = $("button", item);
    btn.addEventListener("click", () => {
      const open = !item.classList.contains("is-open");
      megas.forEach(closeMega);
      item.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
    });
    item.addEventListener("mouseleave", () => closeMega(item));
    item.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMega(item); btn.focus(); } });
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("[data-mega]")) megas.forEach(closeMega); });

  /* ---------- Dialogs ---------- */
  const openDialog = (id) => {
    const dialog = document.getElementById(id);
    if (!dialog || dialog.open) return;
    if (id === "cart-drawer") renderCart();
    if (id === "search-dialog") loadSearch();
    dialog.showModal();
    root.classList.add("modal-open");
  };
  $$("[data-open]").forEach((btn) => btn.addEventListener("click", () => openDialog(btn.dataset.open)));
  $$("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (e) => { if (e.target === dialog || e.target.closest("[data-close]")) dialog.close(); });
    dialog.addEventListener("close", () => root.classList.toggle("modal-open", Boolean($("dialog[open]"))));
  });

  /* ---------- Toast ---------- */
  const toast = $("[data-toast]");
  let toastTimer;
  const showToast = (message) => {
    if (!toast) return;
    // An open modal dialog sits in the top layer, so the toast has to live inside it to be seen.
    ($("dialog[open]") || document.body).append(toast);
    $("[data-toast-msg]", toast).textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
  };

  /* ---------- Cart (localStorage; checkout.js reads the same key) ----------
     Item: {id, slug, name, image, price, qty, options (label), opts {option: value}, note, photos [{key, name, size}], need}.
     The server re-prices everything at checkout, so `price` here is display-only. */
  localStorage.removeItem("kp-cart"); // pre-checkout format had no structured options
  let cart = store.get("kp-cart2", []);
  const cartTotal = () => cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const updateCount = (bump) => {
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    $$("[data-cart-count]").forEach((el) => {
      el.textContent = count;
      el.hidden = count === 0;
      if (bump) { el.classList.remove("is-bump"); void el.offsetWidth; el.classList.add("is-bump"); }
    });
  };
  const saveCart = (bump) => { store.set("kp-cart2", cart); updateCount(bump); };
  const photoNote = (item) => {
    const got = (item.photos || []).length;
    if (item.need) return got >= item.need ? `All ${item.need} photos added` : `${got} of ${item.need} photos added - send the rest after ordering`;
    return got ? `${got} photo${got === 1 ? "" : "s"} added` : "";
  };
  function renderCart() {
    const body = $("[data-cart-body]");
    const foot = $("[data-cart-foot]");
    if (!body) return;
    if (!cart.length) { body.innerHTML = $("#cart-empty-tpl").innerHTML; foot.hidden = true; return; }
    const total = cartTotal();
    const left = Math.max(0, FREE_SHIP - total);
    body.innerHTML =
      `<div class="ship-meter">${left ? `You're <strong>${inr(left)}</strong> away from free shipping` : "<strong>You've unlocked free shipping!</strong>"}` +
      `<div class="ship-meter__bar"><span style="--p:${Math.min(100, (total / FREE_SHIP) * 100)}%"></span></div></div>` +
      cart.map((item, i) => `<div class="cart-item">
        <img src="${esc(item.image)}" alt="" width="76" height="76">
        <div><h3>${esc(item.name)}</h3><p>${esc(item.options)}</p>${photoNote(item) ? `<p class="cart-item__photos">${esc(photoNote(item))}</p>` : ""}
          <div class="cart-item__row">
            <div class="qty"><button type="button" aria-label="Decrease quantity" data-cart-step="-1" data-i="${i}">−</button><input value="${item.qty}" aria-label="Quantity" readonly><button type="button" aria-label="Increase quantity" data-cart-step="1" data-i="${i}">+</button></div>
            <button class="link-btn" type="button" data-cart-remove data-i="${i}">Remove</button>
          </div></div>
        <div class="cart-item__price">${inr(item.price * item.qty)}</div></div>`).join("");
    $("[data-cart-total]").textContent = inr(total);
    foot.hidden = false;
  }
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cart-step], [data-cart-remove]");
    if (!btn) return;
    const i = Number(btn.dataset.i);
    if (btn.hasAttribute("data-cart-remove")) cart.splice(i, 1);
    else cart[i].qty = Math.min(20, Math.max(1, cart[i].qty + Number(btn.dataset.cartStep)));
    saveCart();
    renderCart();
  });
  const addToCart = (item) => {
    // Lines with photos stay separate: each one is its own personalised design.
    const existing = !item.photos.length && cart.find((c) => c.slug === item.slug && c.options === item.options && !(c.photos || []).length);
    if (existing) existing.qty = Math.min(20, existing.qty + item.qty);
    else cart.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...item });
    saveCart(true);
    openDialog("cart-drawer");
  };
  updateCount();

  /* ---------- Wishlist ---------- */
  const wish = new Set(store.get("kp-wish", []));
  $$("[data-wish]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(wish.has(btn.dataset.wish)));
    btn.addEventListener("click", () => {
      const slug = btn.dataset.wish;
      wish.has(slug) ? wish.delete(slug) : wish.add(slug);
      btn.setAttribute("aria-pressed", String(wish.has(slug)));
      store.set("kp-wish", [...wish]);
      showToast(wish.has(slug) ? "Saved to your wishlist" : "Removed from your wishlist");
    });
  });

  /* ---------- Search ---------- */
  let searchData = null;
  async function loadSearch() {
    if (searchData) return;
    try { searchData = await (await fetch(root.dataset.search)).json(); } catch { searchData = []; }
  }
  const searchInput = $("[data-search-input]");
  const searchResults = $("[data-search-results]");
  const searchSuggest = $("[data-search-suggest]");
  searchInput?.addEventListener("input", async () => {
    await loadSearch();
    const q = searchInput.value.trim().toLowerCase();
    searchSuggest.hidden = Boolean(q);
    if (!q) { searchResults.innerHTML = ""; return; }
    const words = q.split(/\s+/);
    const hits = searchData.filter((p) => words.every((w) => p.text.includes(w))).slice(0, 6);
    searchResults.innerHTML = hits.length
      ? hits.map((p) => `<a class="result" href="${p.url}"><img src="${p.image}" alt="" width="56" height="56"><span><strong>${esc(p.name)}</strong><span>${esc(p.meta)}</span></span><b>${inr(p.price)}</b></a>`).join("")
      : `<p class="muted">No matches for “${esc(searchInput.value)}”. Try “polaroid”, “frame” or “couple”.</p>`;
  });

  /* ---------- Tabs (bestseller filters) ---------- */
  $$("[data-tabs]").forEach((list) => {
    const grid = document.getElementById(list.dataset.tabs);
    const tabs = $$("[role=tab]", list);
    const select = (tab) => {
      tabs.forEach((t) => { const on = t === tab; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
      grid.setAttribute("aria-labelledby", tab.id);
      let shown = 0;
      $$(".card", grid).forEach((card) => {
        const match = card.dataset.tags.split(" ").includes(tab.dataset.filter) && shown < 8;
        card.hidden = !match;
        if (match) shown++;
      });
    };
    tabs.forEach((tab) => tab.addEventListener("click", () => select(tab)));
    list.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0 || !["ArrowRight", "ArrowLeft"].includes(e.key)) return;
      e.preventDefault();
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      select(next);
    });
  });

  /* ---------- Carousels ---------- */
  $$("[data-carousel-prev], [data-carousel-next]").forEach((btn) => btn.addEventListener("click", () => {
    const track = document.getElementById(btn.dataset.carouselPrev || btn.dataset.carouselNext);
    const first = track.firstElementChild;
    const step = first ? first.getBoundingClientRect().width + 16 : track.clientWidth * 0.8;
    track.scrollBy({ left: btn.dataset.carouselPrev ? -step : step, behavior: "smooth" });
  }));

  /* ---------- Memoroid maker ---------- */
  const maker = $("[data-maker]");
  if (maker) {
    const figure = $("[data-memoroid]");
    const preview = $("[data-preview]");
    const caption = $("[data-caption]");
    let objectUrl;
    maker.addEventListener("change", (e) => {
      const input = e.target;
      if (input.name === "photo") preview.src = input.dataset.full;
      if (input.name === "style") figure.dataset.style = input.value;
      if (input.matches("[data-upload]") && input.files[0]) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(input.files[0]);
        preview.src = objectUrl;
        $$("input[name=photo]", maker).forEach((r) => { r.checked = false; });
      }
    });
    $("#maker-caption", maker)?.addEventListener("input", (e) => { caption.textContent = e.target.value || " "; });
    maker.addEventListener("submit", (e) => e.preventDefault());
  }

  /* ---------- Product page ---------- */
  const pdp = $("[data-pdp]");
  if (pdp) {
    const qtyInput = $("[data-qty] input", pdp);
    const unitPrice = () => {
      let price = Number(pdp.dataset.price);
      $$("input[data-price]:checked", pdp).forEach((i) => { price = Number(i.dataset.price); });
      return price;
    };
    const qty = () => Math.min(20, Math.max(1, Number(qtyInput.value) || 1));
    // Photos needed for the chosen options (e.g. a 30-print pack needs 30).
    const need = () => {
      let n = Number(pdp.dataset.need) || 0;
      $$("input[data-need]:checked", pdp).forEach((i) => { n = Number(i.dataset.need); });
      return n;
    };

    /* Photos upload straight to storage the moment they're picked, so checkout doesn't wait on them.
       Each: {file, name, size, type, el, state: "up" | "done" | "err" | "off" | "gone", key, xhr} */
    const photoInput = $("[data-photo-input]", pdp);
    const previews = $("[data-previews]", pdp);
    const dropzone = $("[data-dropzone]", pdp);
    const photoStatus = $("[data-photo-status]", pdp);
    const photos = [];
    const MAX_PHOTOS = 100;
    const MAX_BYTES = 25 * 1024 * 1024;
    let uploads = Promise.resolve();
    const paintPhotos = () => {
      if (!photoStatus) return;
      const n = need();
      const count = (s) => photos.filter((p) => p.state === s).length;
      $("[data-need-out]", pdp).textContent = n;
      const parts = [];
      if (photos.length) parts.push(n ? `${photos.length} of ${n} photos added` : `${photos.length} photo${photos.length === 1 ? "" : "s"} added`);
      if (count("up")) parts.push(`uploading ${count("up")}…`);
      if (count("err")) parts.push(`${count("err")} didn't upload - tap ↻ to retry`);
      if (count("off")) parts.push("photo upload is paused right now, so please send them after you order");
      photoStatus.textContent = parts.join(" · ");
      $("strong", dropzone).textContent = photos.length ? "Add more photos" : "Tap to add photos";
    };
    const setState = (p, state) => { if (p.state !== "gone") { p.state = state; p.el.dataset.state = state; } paintPhotos(); };
    const sendPhoto = (p, slot) => new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      p.xhr = xhr;
      xhr.open(slot.method || "PUT", slot.url);
      Object.entries(slot.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) p.el.style.setProperty("--pct", `${Math.round((e.loaded / e.total) * 100)}%`); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) p.key = slot.key;
        setState(p, p.key ? "done" : "err");
        resolve();
      };
      xhr.onerror = xhr.onabort = () => { setState(p, "err"); resolve(); };
      xhr.send(p.file);
    });
    // Batches of up to 20 (one API call for the upload links), three files at a time on the wire.
    const upload = (batch) => {
      uploads = uploads.then(async () => {
        batch = batch.filter((p) => p.state === "up");
        if (!batch.length) return;
        let slots;
        try {
          ({ uploads: slots } = await api("uploads", { slug: pdp.dataset.slug, files: batch.map((p) => ({ name: p.name, type: p.type, size: p.size })) }));
        } catch (err) {
          batch.forEach((p) => setState(p, err.status === 503 ? "off" : "err"));
          return;
        }
        const jobs = batch.map((p, i) => [p, slots[i]]);
        const worker = async () => { for (let job = jobs.shift(); job; job = jobs.shift()) if (job[0].state === "up") await sendPhoto(...job); };
        await Promise.all([worker(), worker(), worker()]);
      });
      return uploads;
    };
    const addPhotos = (files) => {
      const fit = files.filter((f) => (f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)) && f.size <= MAX_BYTES);
      if (fit.length < files.length) showToast("Some files were skipped - photos only, up to 25 MB each");
      const fresh = fit.slice(0, Math.max(0, MAX_PHOTOS - photos.length)).map((file) => {
        const el = document.createElement("div");
        el.className = "thumb";
        const img = new Image();
        img.alt = "";
        img.onerror = () => el.classList.add("is-noprev"); // e.g. HEIC outside Safari
        img.src = URL.createObjectURL(file);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "thumb__x";
        remove.setAttribute("aria-label", `Remove ${file.name}`);
        remove.textContent = "×";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "thumb__retry";
        retry.setAttribute("aria-label", `Retry uploading ${file.name}`);
        retry.textContent = "↻";
        el.append(img, remove, retry);
        previews.append(el);
        const p = { file, name: file.name, size: file.size, type: file.type || "", el, state: "up" };
        el.dataset.state = "up";
        remove.addEventListener("click", () => {
          p.state = "gone";
          p.xhr?.abort();
          URL.revokeObjectURL(img.src);
          el.remove();
          photos.splice(photos.indexOf(p), 1);
          paintPhotos();
        });
        retry.addEventListener("click", () => { setState(p, "up"); upload([p]); });
        return p;
      });
      photos.push(...fresh);
      paintPhotos();
      for (let i = 0; i < fresh.length; i += 20) upload(fresh.slice(i, i + 20));
    };
    photoInput?.addEventListener("change", () => { addPhotos([...photoInput.files]); photoInput.value = ""; });
    ["dragenter", "dragover"].forEach((t) => dropzone?.addEventListener(t, () => dropzone.classList.add("is-over")));
    ["dragleave", "drop"].forEach((t) => dropzone?.addEventListener(t, () => dropzone.classList.remove("is-over")));

    const refresh = () => {
      $$("[data-price-out]").forEach((out) => { out.textContent = inr(unitPrice() * qty()); });
      $$(".opt", pdp).forEach((set) => { const checked = $("input:checked", set); if (checked) $("output", set).textContent = checked.value; });
      paintPhotos();
    };
    pdp.addEventListener("change", refresh);
    qtyInput.addEventListener("input", refresh);
    $$("[data-qty] button", pdp).forEach((btn) => btn.addEventListener("click", () => {
      qtyInput.value = Math.min(20, Math.max(1, qty() + Number(btn.dataset.step)));
      refresh();
    }));

    const addBtn = $("[data-add]", pdp);
    pdp.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (addBtn.disabled) return;
      if (photos.some((p) => p.state === "up")) {
        const label = addBtn.innerHTML;
        addBtn.disabled = true;
        addBtn.textContent = "Uploading your photos…";
        for (let i = 0; i < 100 && photos.some((p) => p.state === "up"); i++) await uploads;
        addBtn.innerHTML = label;
        addBtn.disabled = false;
        refresh();
      }
      const opts = {};
      $$("[data-opt-name]", pdp).forEach((set) => { const c = $("input:checked", set); if (c) opts[set.dataset.optName] = c.value; });
      const labels = Object.values(opts);
      const note = ($("#note", pdp)?.value || "").trim().slice(0, 60);
      if (note) labels.push(`“${note}”`);
      addToCart({
        slug: pdp.dataset.slug, name: pdp.dataset.name, image: pdp.dataset.image, price: unitPrice(), qty: qty(),
        options: labels.join(" · "), opts, note, need: need(),
        photos: photos.filter((p) => p.state === "done").map((p) => ({ key: p.key, name: p.name, size: p.size })),
      });
      // Those photos now belong to that cart line - start fresh for the next one.
      photos.splice(0).forEach((p) => { URL.revokeObjectURL($("img", p.el).src); p.el.remove(); });
      paintPhotos();
    });

    const pin = $("[data-pin]");
    const pinOut = $("[data-pin-out]");
    const checkPin = () => {
      if (!/^[1-9][0-9]{5}$/.test(pin.value.trim())) { pinOut.style.color = "var(--kiss)"; pinOut.textContent = "Please enter a valid 6-digit pincode."; return; }
      const date = new Date();
      for (let added = 0; added < 6;) { date.setDate(date.getDate() + 1); if (date.getDay() !== 0) added++; }
      pinOut.style.color = "";
      pinOut.textContent = `Get it by ${date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} to ${pin.value.trim()}`;
    };
    $("[data-pin-check]")?.addEventListener("click", checkPin);
    pin?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); checkPin(); } });

    const main = $("[data-gallery-main]");
    $$("[data-gallery] .gallery__thumbs button").forEach((btn, _, all) => btn.addEventListener("click", () => {
      all.forEach((b) => b.setAttribute("aria-current", String(b === btn)));
      main.previousElementSibling.srcset = btn.dataset.avif;
      main.srcset = btn.dataset.webp;
      main.alt = btn.dataset.alt;
    }));

    const bar = $("[data-sticky-buy]");
    if (bar && "IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        bar.classList.toggle("is-visible", show);
        bar.inert = !show;
      }).observe(addBtn);
      $("[data-sticky-add]")?.addEventListener("click", () => pdp.requestSubmit());
    }
  }

  /* ---------- Collection pages: sort + ?q= search ---------- */
  const sort = $("[data-sort]");
  if (sort) {
    const grid = document.getElementById(sort.dataset.sort);
    const cards = $$(".card", grid);
    cards.forEach((card, i) => { card.dataset.i = i; });
    sort.addEventListener("change", () => {
      const by = {
        "price-asc": (a, b) => a.dataset.price - b.dataset.price,
        "price-desc": (a, b) => b.dataset.price - a.dataset.price,
        rating: (a, b) => b.dataset.rating - a.dataset.rating,
      }[sort.value] || ((a, b) => a.dataset.i - b.dataset.i);
      grid.append(...[...cards].sort(by));
    });
    const q = new URLSearchParams(location.search).get("q")?.trim().toLowerCase();
    if (q) {
      const words = q.split(/\s+/);
      let shown = 0;
      cards.forEach((card) => { const hit = words.every((w) => card.dataset.search.includes(w)); card.hidden = !hit; shown += hit; });
      const title = $("[data-plp-title]");
      if (title) title.textContent = `Results for “${q}”`;
      $("[data-count]").textContent = `${shown} ${shown === 1 ? "product" : "products"}`;
      $("[data-empty]").hidden = shown > 0;
    }
  }

  /* ---------- Forms (static demo: no backend yet) ---------- */
  $$("[data-newsletter], [data-demo-form]").forEach((form) => form.addEventListener("submit", (e) => {
    e.preventDefault();
    const done = document.createElement("p");
    done.className = "form-done";
    done.setAttribute("role", "status");
    done.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>';
    done.append(form.dataset.demoForm || "You're in! Check your inbox for your ₹100 welcome code.");
    form.replaceWith(done);
  }));
})();
