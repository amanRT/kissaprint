"use client";
// The team's order dashboard: live list (checks every 30 s, chime on new paid orders), order detail with photos
// and a one-click .zip, status / courier / tracking updates, and deletable test orders.
// Every API call here is re-authorised on the server (JWT + is_admin re-read from the database).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiError } from "@/lib/client-api";
import { inr, phoneDisplay, when } from "@/lib/format";
import { AdminNav } from "./nav";

type Summary = { id: string; created_at: string; status: string; name: string; phone: string; city: string; state: string; total: number; items: string[]; photos: number; photos_needed: number; gateway: string; test: boolean };
type Line = { slug: string; name: string; options: [string, string][]; note: string; qty: number; line_total: number; photos: { key: string; name: string; size: number }[]; photos_needed: number };
type Order = {
  id: string; created_at: string; status: string; gateway: string; token: string; total: number; subtotal: number; shipping: number;
  customer: { name: string; phone: string; email: string }; address: { line1: string; line2: string; city: string; state: string; pincode: string };
  items: Line[]; razorpay_order_id: string | null; razorpay_payment_id: string | null; payment: Record<string, unknown> | null;
  tracking: { courier: string; number: string; url: string } | null; notes: string; history: { at: string; status: string; note?: string }[];
};
type ListRes = { orders: Summary[]; counts: Record<string, number>; latest: string };

const STATUS: Record<string, string> = { pending: "Unpaid", paid: "New", printing: "Printing", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled", refunded: "Refunded" };
const TABS: [string, string][] = [["new", "New"], ["printing", "Printing"], ["shipped", "Shipped"], ["delivered", "Delivered"], ["unpaid", "Unpaid"], ["closed", "Cancelled"], ["all", "All"]];
const HINTS: Record<string, string> = {
  new: "Paid and waiting to be printed - oldest first, so nobody waits too long.",
  printing: "In production, oldest first. Add the courier and tracking number when you ship.",
  shipped: "On the way to the customer.",
  delivered: "Done and dusted.",
  unpaid: "Checkouts where the payment didn't complete. A friendly WhatsApp sometimes rescues these.",
  closed: "Cancelled or refunded orders. Refunds themselves are made in the Razorpay dashboard.",
  all: "Every order, newest first.",
};
const TEST_HOW: Record<string, string> = { mock: "paid with the local test payment window", razorpay_test: "paid with Razorpay test keys", bypass: "placed from a team test account, so payment was skipped" };
const POLL_MS = 30000;
const clock = () => new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" });
const ago = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return when(iso);
};

// ---------- .zip of an order's photos (stored, not compressed: the photos are JPEGs already)
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  let size = 0;
  const put = (view: DataView, fields: [number, number, 2 | 4][]) => fields.forEach(([at, v, n]) => (n === 4 ? view.setUint32(at, v, true) : view.setUint16(at, v, true)));
  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    put(head, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nameBytes.length, 2]]);
    const dir = new DataView(new ArrayBuffer(46));
    put(dir, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nameBytes.length, 2], [42, offset, 4]]);
    parts.push(head, nameBytes as BlobPart, data as BlobPart);
    central.push(dir, nameBytes as BlobPart);
    offset += 30 + nameBytes.length + data.length;
    size += 46 + nameBytes.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  put(end, [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4]]);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

export function AdminApp({ user, mode, problems, logo, icons }: {
  user: { name: string; email: string }; mode: string; problems: string[]; logo: React.ReactNode;
  icons: Record<"refresh" | "search" | "close" | "check", React.ReactNode>;
}) {
  const [tab, setTab] = useState("new");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<ListRes | null>(null);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState("");
  const [detail, setDetail] = useState<{ order: Order; photos: Record<string, string> } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const latest = useRef<string | null>(null);
  const paidWaiting = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);

  const say = useCallback((message: string) => setToast(message), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const signedOut = (err: unknown) => {
    const status = (err as ApiError).status;
    if (status === 401 || status === 403) { location.assign("/login/?expired=1&next=/admin/"); return true; }
    return false;
  };

  // A short two-note chime for new paid orders. Browsers only allow sound after a click on the page.
  useEffect(() => {
    const unlock = () => { try { audio.current ??= new AudioContext(); audio.current.resume(); } catch { /* no audio */ } };
    document.addEventListener("click", unlock, { once: true });
    return () => document.removeEventListener("click", unlock);
  }, []);
  const chime = () => {
    const ctx = audio.current;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.2, t + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.18);
      osc.stop(t + i * 0.18 + 0.55);
    });
  };

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await api<ListRes>(`/api/admin/orders/?${new URLSearchParams({ tab, q: query })}`);
      latest.current = data.latest;
      if (paidWaiting.current !== null && data.counts.new > paidWaiting.current) {
        const n = data.counts.new - paidWaiting.current;
        say(n === 1 ? "New paid order - it's in the New tab" : `${n} new paid orders - they're in the New tab`);
        chime();
      }
      paidWaiting.current = data.counts.new;
      document.title = `${data.counts.new ? `(${data.counts.new}) ` : ""}Orders | KissaPrints admin`;
      setList(data);
      setListError("");
      setUpdated(`Live · updated ${clock()}`);
    } catch (err) {
      if (!signedOut(err)) setListError((err as Error).message);
    }
    setLoading(false);
  }, [tab, query, say]);
  useEffect(() => { load(); }, [load]);

  // No refresh button needed: every 30 s ask for the newest change (one tiny row); reload only if it moved.
  useEffect(() => {
    const poll = async () => {
      try {
        const { latest: now } = await api<{ latest: string }>("/api/admin/changes/");
        if (now !== latest.current) await load(true);
        else setUpdated(`Live · checked ${clock()}`);
      } catch (err) { signedOut(err); /* offline for a moment - the next check retries */ }
    };
    const id = setInterval(poll, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const openOrder = async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setDetailError("");
    if (!dialog.current?.open) dialog.current?.showModal();
    try {
      setDetail(await api<{ order: Order; photos: Record<string, string> }>(`/api/admin/order/?id=${encodeURIComponent(id)}`));
    } catch (err) {
      if (!signedOut(err)) setDetailError((err as Error).message);
    }
  };
  const closeDetail = () => dialog.current?.close();

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex(([k]) => k === tab);
    if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS[next][0]);
    tabButtons.current[next]?.focus();
  };

  const toastEl = toast && <div className="toast is-visible" role="status" aria-live="polite">{icons.check}<span>{toast}</span></div>;

  return (
    <>
      <header className="adm-top">
        <div className="adm-top__bar">
          {logo}
          <AdminNav current="orders" />
          {mode && <span className="adm-mode">{mode}</span>}
          <div className="adm-top__actions">
            <span className="adm-who adm-hide-sm" title={user.email}>{user.name}</span>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => load()}>{icons.refresh}<span className="adm-hide-sm">Refresh</span></button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={async () => { await api("auth/logout", {}).catch(() => {}); location.assign("/login/"); }}>Sign out</button>
          </div>
        </div>
      </header>

      <main id="main" className="adm">
        <section className="adm-dash">
          {problems.length > 0 && <div className="co-error adm-setup" role="status"><strong>Setup needs attention:</strong><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
          <div className="adm-toolbar">
            <div className="adm-tabs" role="tablist" aria-label="Order status" onKeyDown={onTabKey}>
              {TABS.map(([key, label], i) => (
                <button key={key} ref={(el) => { tabButtons.current[i] = el; }} role="tab" type="button" id={`tab-${key}`} aria-selected={tab === key}
                  aria-controls="adm-list" tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>
                  {label} <span className="adm-count">{list?.counts[key] ?? 0}</span>
                </button>
              ))}
            </div>
            <label className="adm-search">{icons.search}<span className="sr-only">Search orders</span>
              <input className="input" type="search" placeholder="Search order, name, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
          <p className="adm-hint"><span>{HINTS[tab]}</span>{updated && <span className="adm-live">{updated}</span>}</p>
          <div className="adm-list" id="adm-list" role="tabpanel" aria-labelledby={`tab-${tab}`} aria-busy={loading}>
            {listError ? <p className="co-error">{listError}</p>
              : !list ? <p className="adm-empty">Loading orders…</p>
              : list.orders.length ? list.orders.map((o) => {
                const short = o.photos_needed && o.photos < o.photos_needed;
                const fresh = Date.now() - new Date(o.created_at).getTime() < 3600000;
                return (
                  <button key={o.id} className="adm-row" type="button" data-order={o.id} onClick={() => openOrder(o.id)}>
                    <span className="adm-row__top">
                      <strong>{o.id}</strong><span className={`adm-status adm-status--${o.status}`}>{STATUS[o.status]}</span>
                      {o.test && <span className="adm-test" title="Test payment - no real money">Test</span>}
                      {fresh && <span className="adm-dot" title="Placed in the last hour" />}
                      <span className="adm-row__total">{inr(o.total)}</span>
                    </span>
                    <span className="adm-row__who">{o.name} · {o.city}, {o.state}</span>
                    <span className="adm-row__items">{o.items.join(", ")}</span>
                    <span className="adm-row__meta"><span>{ago(o.created_at)}</span>
                      {(o.photos_needed > 0 || o.photos > 0) && <span className={short ? "adm-warn" : ""}>{o.photos}{o.photos_needed ? ` / ${o.photos_needed}` : ""} photos</span>}</span>
                  </button>
                );
              }) : (
                <p className="adm-empty">{query ? "No orders match that search." : "Nothing here right now."}
                  {!query && tab !== "all" && list.counts.all > 0 && <> <button className="link-btn" type="button" onClick={() => setTab("all")}>See all {list.counts.all} order{list.counts.all === 1 ? "" : "s"}</button></>}
                </p>
              )}
          </div>
        </section>
      </main>

      <dialog ref={dialog} className="drawer adm-drawer" aria-labelledby="adm-detail-title" data-detail
        onClose={() => { setDetailId(null); setDetail(null); load(true); }}
        onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}>
        <div className="drawer__panel">
          <div className="drawer__head"><h2 id="adm-detail-title">{detailId}</h2><button className="icon-btn" type="button" aria-label="Close" data-close onClick={closeDetail}>{icons.close}</button></div>
          <div className="drawer__body adm-detail" data-detail-body>
            {detailError ? <p className="co-error">{detailError}</p> : !detail ? <p className="muted">Loading…</p>
              : <OrderDetail key={detail.order.id} {...detail} say={say} onSaved={(order) => setDetail({ ...detail, order })} onDeleted={() => { closeDetail(); say(`Test order ${detail.order.id} deleted`); }} signedOut={signedOut} />}
          </div>
        </div>
        {detailId && toastEl}
      </dialog>
      {!detailId && toastEl}
    </>
  );
}

function OrderDetail({ order: o, photos, say, onSaved, onDeleted, signedOut }: {
  order: Order; photos: Record<string, string>; say: (m: string) => void; onSaved: (o: Order) => void; onDeleted: () => void; signedOut: (err: unknown) => boolean;
}) {
  const [form, setForm] = useState({ status: o.status, courier: o.tracking?.courier ?? "", number: o.tracking?.number ?? "", url: o.tracking?.url ?? "", note: "", notes: o.notes ?? "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [zipping, setZipping] = useState<string | null>(null);
  const c = o.customer;
  const pay = (o.payment ?? {}) as { method?: string; vpa?: string; card?: { network?: string; last4?: string }; refunds?: { id: string; amount: number; status: string; at: string }[] };
  const totalPhotos = o.items.reduce((n, it) => n + it.photos.length, 0);
  const test = ["mock", "razorpay_test", "bypass"].includes(o.gateway);
  const address = [c.name, o.address.line1, o.address.line2, `${o.address.city}, ${o.address.state} ${o.address.pincode}`, phoneDisplay(c.phone)].filter(Boolean).join("\n");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { order } = await api<{ order: Order }>("admin/order", {
        id: o.id, status: form.status, note: form.note.trim(), notes: form.notes,
        tracking: { courier: form.courier.trim(), number: form.number.trim(), url: form.url.trim() },
      });
      onSaved(order);
      say("Saved");
    } catch (err) {
      if (!signedOut(err)) { setError((err as Error).message); setSaving(false); }
    }
  };

  const download = async () => {
    const jobs = o.items.flatMap((it, i) => it.photos.map((ph, j) => ({ it, i, j, ph })));
    const files: { name: string; data: Uint8Array }[] = [];
    try {
      for (const [n, { it, i, j, ph }] of jobs.entries()) {
        setZipping(`Downloading ${n + 1} of ${jobs.length}…`);
        if (!photos[ph.key]) continue;
        const res = await fetch(photos[ph.key]);
        if (!res.ok) throw new Error(`Couldn't download ${ph.name}`);
        const ext = ph.key.split(".").pop();
        const base = ph.name.replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "_").slice(0, 60) || "photo";
        files.push({ name: `${o.id}/${String(i + 1).padStart(2, "0")}-${it.slug}/${String(j + 1).padStart(3, "0")}-${base}.${ext}`, data: new Uint8Array(await res.arrayBuffer()) });
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zip(files));
      a.download = `${o.id}-photos.zip`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      say(`${files.length} photos zipped`);
    } catch (err) {
      say((err as Error).message);
    }
    setZipping(null);
  };

  const remove = async () => {
    if (!window.confirm(`Delete test order ${o.id} and its photos? This can't be undone.`)) return;
    try { await api("admin/delete", { id: o.id }); onDeleted(); } catch (err) { if (!signedOut(err)) say((err as Error).message); }
  };

  return (
    <>
      <div className="adm-sum"><span className={`adm-status adm-status--${o.status}`}>{STATUS[o.status]}</span>{test && <span className="adm-test">Test</span>}<span>Placed {when(o.created_at)}</span><strong>{inr(o.total)}</strong></div>
      {test && (
        <div className="adm-test-note">
          <p><strong>Test order:</strong> {TEST_HOW[o.gateway]}. No real money moved, so don&apos;t print or ship it.</p>
          <button className="btn btn--ghost btn--sm" type="button" data-delete onClick={remove}>Delete test order</button>
        </div>
      )}
      <section className="adm-card"><h3>Customer</h3>
        <p><strong>{c.name}</strong></p>
        <p><a href={`tel:+91${c.phone}`}>{phoneDisplay(c.phone)}</a> · <a href={`https://wa.me/91${c.phone}`} target="_blank" rel="noopener">WhatsApp</a></p>
        <p><a href={`mailto:${c.email}?subject=${encodeURIComponent(`Your KissaPrints order ${o.id}`)}`}>{c.email}</a></p>
      </section>
      <section className="adm-card"><h3>Ship to <button className="link-btn" type="button" data-copy onClick={async () => {
        try { await navigator.clipboard.writeText(address); say("Address copied"); } catch { say("Couldn't copy - select the address instead"); }
      }}>Copy address</button></h3>
        <address>{address.split("\n").map((line, i) => <span key={i}>{line}<br /></span>)}</address>
      </section>
      <section className="adm-card"><h3>Items{totalPhotos > 0 && <> <button className="btn btn--ghost btn--sm" type="button" data-zip disabled={Boolean(zipping)} onClick={download}>{zipping ?? `Download ${totalPhotos} photo${totalPhotos === 1 ? "" : "s"} (.zip)`}</button></>}</h3>
        {o.items.map((it, i) => (
          <div className="adm-item" key={i}>
            <div className="adm-item__head"><strong>{it.name} × {it.qty}</strong><span>{inr(it.line_total)}</span></div>
            <p>{it.options.map(([k, v], n) => <span key={k}>{n > 0 && " · "}{k}: <strong>{v}</strong></span>)}</p>
            {it.note && <p>Caption: <strong>“{it.note}”</strong></p>}
            {(it.photos_needed > 0 || it.photos.length > 0) && (
              <p className={it.photos.length < it.photos_needed ? "adm-warn" : "adm-ok"}>{it.photos.length}{it.photos_needed ? ` of ${it.photos_needed}` : ""} photos uploaded{it.photos.length < it.photos_needed ? " - ask the customer for the rest" : ""}</p>
            )}
            {it.photos.length > 0 && (
              <div className="adm-photos">
                {it.photos.map((ph) => photos[ph.key]
                  ? <a key={ph.key} href={photos[ph.key]} target="_blank" rel="noopener" title={ph.name}><img src={photos[ph.key]} alt={ph.name} loading="lazy" /></a>
                  : <span key={ph.key} className="adm-photo-missing" title={ph.name}>missing</span>)}
              </div>
            )}
          </div>
        ))}
        <dl className="co-totals"><div><dt>Subtotal</dt><dd>{inr(o.subtotal)}</dd></div><div><dt>Shipping</dt><dd>{o.shipping ? inr(o.shipping) : "Free"}</dd></div><div className="co-totals__total"><dt>Total</dt><dd>{inr(o.total)}</dd></div></dl>
      </section>
      <section className="adm-card"><h3>Payment</h3>
        {o.razorpay_payment_id ? (
          <>
            <p>{pay.method ? pay.method.toUpperCase() : "Paid"}{pay.vpa ? ` · ${pay.vpa}` : ""}{pay.card ? ` · ${pay.card.network ?? ""} ${pay.card.last4 ? "•••• " + pay.card.last4 : ""}` : ""}</p>
            <p className="adm-mono">{o.razorpay_payment_id}</p>
            {pay.refunds?.map((r) => <p key={r.id} className={r.status === "failed" ? "adm-warn" : "muted"}>Refund {inr(r.amount)} · {r.status} · {when(r.at)} <span className="adm-mono">{r.id}</span></p>)}
            {o.gateway === "mock" ? <p className="muted">Local test payment</p>
              : <p><a href={`https://dashboard.razorpay.com/app/payments/${encodeURIComponent(o.razorpay_payment_id)}`} target="_blank" rel="noopener">Open in Razorpay{o.gateway === "razorpay_test" ? " (test mode)" : ""} ↗</a></p>}
          </>
        ) : o.gateway === "bypass" ? <p className="muted">Payment skipped - team test account.</p>
          : <><p className="adm-warn">Not paid yet.</p><p className="adm-mono">{o.razorpay_order_id}</p></>}
      </section>
      <form className="adm-card form" data-update noValidate onSubmit={save}>
        <h3>Update order</h3>
        <label>Status
          <select className="input select" name="status" value={form.status} onChange={set("status")}>
            {Object.keys(STATUS).filter((s) => s !== "pending" || o.status === "pending").map((s) => <option key={s} value={s}>{s === "paid" ? "New - paid, to print" : STATUS[s]}</option>)}
          </select>
        </label>
        <div className="form-row">
          <label>Courier<input className="input" name="courier" value={form.courier} onChange={set("courier")} placeholder="Delhivery, Shiprocket…" /></label>
          <label>Tracking number<input className="input" name="number" value={form.number} onChange={set("number")} /></label>
        </div>
        <label>Tracking link<input className="input" name="url" type="url" value={form.url} onChange={set("url")} placeholder="https://" /></label>
        <label>Note for the customer&apos;s timeline <span className="co-optional">(optional)</span><input className="input" name="note" maxLength={280} value={form.note} onChange={set("note")} /></label>
        <label>Internal notes <span className="co-optional">(only the team sees these)</span><textarea className="input" name="notes" rows={3} maxLength={4000} value={form.notes} onChange={set("notes")} /></label>
        <p className="co-error" hidden={!error}>{error}</p>
        <button className="btn btn--kiss" type="submit" disabled={saving}>Save changes</button>
        <p className="adm-fine">Customers see the status and tracking on their order page. Make refunds in the Razorpay dashboard, then set the status to Refunded.</p>
      </form>
      <section className="adm-card"><h3>History</h3>
        <ol className="adm-history">{[...o.history].reverse().map((h, i) => <li key={i}><strong>{STATUS[h.status]}</strong> · {when(h.at)}{h.note && <><br /><span>{h.note}</span></>}</li>)}</ol>
        <p><a href={`/order/?id=${encodeURIComponent(o.id)}&t=${encodeURIComponent(o.token)}`} target="_blank" rel="noopener">Open the customer&apos;s order page ↗</a></p>
      </section>
    </>
  );
}
