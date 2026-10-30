"use client";
// Sort + ?q= search for collection pages. Cards are server-rendered; this only reorders / hides them.
import { useEffect, useMemo, useState } from "react";

type Item = { key: string; price: number; rating: number; search: string; node: React.ReactNode };

export function CollectionResults({ heading, chips, items }: { heading: string; chips: React.ReactNode; items: Item[] }) {
  const [sort, setSort] = useState("featured");
  const [q, setQ] = useState("");
  // Read ?q= after mount (no useSearchParams), so the static HTML is the full, unfiltered list.
  useEffect(() => { setQ(new URLSearchParams(location.search).get("q")?.trim().toLowerCase() ?? ""); }, []);
  useEffect(() => {
    if (!q) return;
    const title = document.querySelector("[data-plp-title]");
    if (title) title.textContent = `Results for “${q}”`;
  }, [q]);

  const words = q.split(/\s+/).filter(Boolean);
  const visible = items.map((it) => words.every((w) => it.search.includes(w)));
  const shown = visible.filter(Boolean).length;
  const order = useMemo(() => {
    const idx = items.map((_, i) => i);
    const by: Record<string, (a: number, b: number) => number> = {
      "price-asc": (a, b) => items[a].price - items[b].price,
      "price-desc": (a, b) => items[b].price - items[a].price,
      rating: (a, b) => items[b].rating - items[a].rating,
    };
    return by[sort] ? idx.sort(by[sort]) : idx;
  }, [items, sort]);

  return (
    <>
      <div className="toolbar">
        {chips}
        <div className="sort"><label htmlFor="sort-by">Sort</label>
          <select className="select" id="sort-by" data-sort="plp-grid" aria-label="Sort products" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="featured">Featured</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="rating">Top rated</option>
          </select>
        </div>
      </div>
      <p className="count" data-count aria-live="polite">{shown} {shown === 1 ? "product" : "products"}</p>
      <h2 className="sr-only">{heading} - products</h2>
      <div className="grid-products" id="plp-grid" style={{ marginTop: 18 }}>
        {order.map((i) => (
          <div key={items[i].key} className="grid-item" hidden={!visible[i]} data-price={items[i].price} data-rating={items[i].rating}>{items[i].node}</div>
        ))}
      </div>
      <p className="empty-state" data-empty hidden={shown > 0}>
        {items.length ? "No gifts match that search yet." : "These gifts are taking a short break - back soon."} <a href="/shop/">See everything</a> or <a href="/contact/">ask us for something custom</a>.
      </p>
    </>
  );
}
