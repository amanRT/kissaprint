"use client";
// Which products are on the website. Switching one off hides it everywhere on the shop (listings, search, menus,
// sitemap), its page says it's unavailable, and the server refuses to sell it - e.g. when something runs out.
import { useEffect, useMemo, useState } from "react";
import { api, type ApiError } from "@/lib/client-api";
import { inr, when } from "@/lib/format";
import { AdminNav } from "./nav";

type Row = { slug: string; name: string; category: string; price: number; url: string; image: string; hidden: boolean; updated_at: string | null; updated_by: string; last_in: string[] };
type Filter = "all" | "live" | "hidden";
const FILTERS: [Filter, string][] = [["all", "All"], ["live", "On the website"], ["hidden", "Hidden"]];

export function ProductsAdmin({ user, logo, icons }: {
  user: { name: string; email: string }; logo: React.ReactNode; icons: { search: React.ReactNode; check: React.ReactNode; external: React.ReactNode };
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const signedOut = (err: unknown) => {
    const status = (err as ApiError).status;
    if (status === 401 || status === 403) { location.assign("/login/?expired=1&next=/admin/products/"); return true; }
    return false;
  };
  useEffect(() => {
    api<{ products: Row[] }>("/api/admin/products/").then((r) => setRows(r.products)).catch((err) => { if (!signedOut(err)) setError((err as Error).message); });
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const toggle = async (row: Row) => {
    setBusy(row.slug);
    setError("");
    try {
      const { product, emptied } = await api<{ product: Pick<Row, "slug" | "hidden" | "updated_at" | "updated_by" | "last_in">; emptied: string[] }>("admin/products", { slug: row.slug, hidden: !row.hidden });
      // Other rows' "last one in…" warnings depend on this change, so reload the list quietly.
      setRows((all) => all && all.map((r) => (r.slug === product.slug ? { ...r, ...product } : r)));
      api<{ products: Row[] }>("/api/admin/products/").then((r) => setRows(r.products)).catch(() => {});
      setToast(product.hidden
        ? `${row.name} is hidden - customers can't see or order it${emptied.length ? `. ${emptied.join(", ")} ${emptied.length > 1 ? "are" : "is"} hidden too (nothing else in ${emptied.length > 1 ? "them" : "it"})` : ""}`
        : `${row.name} is back on the website`);
    } catch (err) {
      if (!signedOut(err)) setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => ({ all: rows?.length ?? 0, live: rows?.filter((r) => !r.hidden).length ?? 0, hidden: rows?.filter((r) => r.hidden).length ?? 0 }), [rows]);
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (rows ?? []).filter((r) => (filter === "all" || (filter === "hidden") === r.hidden) && words.every((w) => `${r.name} ${r.category}`.toLowerCase().includes(w)));

  return (
    <>
      <header className="adm-top">
        <div className="adm-top__bar">
          {logo}
          <AdminNav current="products" />
          <div className="adm-top__actions">
            <span className="adm-who adm-hide-sm" title={user.email}>{user.name}</span>
            <button className="btn btn--ghost btn--sm" type="button" onClick={async () => { await api("auth/logout", {}).catch(() => {}); location.assign("/login/"); }}>Sign out</button>
          </div>
        </div>
      </header>

      <main id="main" className="adm">
        <section className="adm-dash">
          <div className="adm-toolbar">
            <div className="adm-tabs" role="tablist" aria-label="Show products">
              {FILTERS.map(([key, label]) => (
                <button key={key} role="tab" type="button" aria-selected={filter === key} aria-controls="adm-products" onClick={() => setFilter(key)}>
                  {label} <span className="adm-count">{counts[key]}</span>
                </button>
              ))}
            </div>
            <label className="adm-search">{icons.search}<span className="sr-only">Search products</span>
              <input className="input" type="search" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
          <p className="adm-hint"><span>Switch a product off when it runs out: it disappears from the shop, search and menus, its page says
            it&apos;s unavailable, and nobody can order it. A category or occasion with nothing left on the website disappears too.
            Orders already placed aren&apos;t affected. Switch it on again any time.</span></p>
          {error && <p className="co-error" role="alert">{error}</p>}

          <ul className="adm-prods" id="adm-products" aria-busy={!rows}>
            {!rows && !error && <li className="adm-empty">Loading products…</li>}
            {rows && !shown.length && <li className="adm-empty">{filter === "hidden" && !search ? "Every product is on the website." : "No products match."}</li>}
            {shown.map((r) => (
              <li key={r.slug} className={`adm-prod${r.hidden ? " is-hidden" : ""}`}>
                <img src={r.image} alt="" width={56} height={56} loading="lazy" />
                <div className="adm-prod__main">
                  <strong>{r.name}</strong>
                  <span>{r.category} · {inr(r.price)}</span>
                  {r.updated_at && <span className="adm-fine">{r.hidden ? "Hidden" : "Switched on"} by {r.updated_by || "the team"} · {when(r.updated_at)}</span>}
                  {r.last_in.length > 0 && <span className="adm-fine adm-prod__warn">Last one showing in {r.last_in.join(", ")} - hiding it hides {r.last_in.length > 1 ? "those" : "that"} too</span>}
                </div>
                <a className="adm-prod__view adm-hide-sm" href={r.url} target="_blank" rel="noopener">View {icons.external}</a>
                <button className="adm-switch" type="button" role="switch" aria-checked={!r.hidden} disabled={busy === r.slug}
                  aria-label={`${r.name} on the website`} onClick={() => toggle(r)}>
                  <span className="adm-switch__track" aria-hidden="true"><span className="adm-switch__thumb" /></span>
                  <span className="adm-switch__label">{busy === r.slug ? "Saving…" : r.hidden ? "Hidden" : "On website"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
      {toast && <div className="toast is-visible" role="status" aria-live="polite">{icons.check}<span>{toast}</span></div>}
    </>
  );
}
