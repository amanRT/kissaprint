"use client";
// Search dialog and cart drawer (the mobile menu is a ShopDialog with server-rendered content, see header.tsx).
import { useEffect, useRef, useState } from "react";
import { inr } from "@/lib/format";
import { ShopDialog, useShop, type CartItem } from "./provider";

type Hit = { name: string; url: string; meta: string; price: number; image: string; text: string };
let index: Promise<Hit[]> | null = null;
const loadIndex = (): Promise<Hit[]> =>
  (index ??= fetch("/search.json").then((r) => r.json() as Promise<Hit[]>).catch(() => { index = null; return [] as Hit[]; }));

export function SearchDialog({ suggestions, searchIcon, closeIcon }: { suggestions: React.ReactNode; searchIcon: React.ReactNode; closeIcon: React.ReactNode }) {
  const { dialog } = useShop();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (dialog === "search-dialog") { loadIndex(); input.current?.focus(); } }, [dialog]);
  useEffect(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { setHits(null); return; }
    let live = true;
    loadIndex().then((all) => { if (live) setHits(all.filter((p) => words.every((w) => p.text.includes(w))).slice(0, 6)); });
    return () => { live = false; };
  }, [q]);
  return (
    <ShopDialog id="search-dialog" className="search-dialog" label="Search products">
      <div className="search-panel">
        <form className="search-form" action="/shop/" method="get" role="search">
          {searchIcon}
          <label className="sr-only" htmlFor="search-input">Search KissaPrints</label>
          <input ref={input} id="search-input" type="search" name="q" placeholder="Search polaroids, frames, gifts for her…" autoComplete="off"
            data-search-input value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="icon-btn" type="button" aria-label="Close search" data-close>{closeIcon}</button>
        </form>
        <div className="search-body">
          <div data-search-suggest hidden={Boolean(q.trim())}>{suggestions}</div>
          <div className="results" data-search-results aria-live="polite">
            {hits && (hits.length
              ? hits.map((p) => (
                <a key={p.url} className="result" href={p.url}>
                  <img src={p.image} alt="" width={56} height={56} />
                  <span><strong>{p.name}</strong><span>{p.meta}</span></span><b>{inr(p.price)}</b>
                </a>
              ))
              : <p className="muted">No matches for “{q}”. Try “polaroid”, “frame” or “couple”.</p>)}
          </div>
        </div>
      </div>
    </ShopDialog>
  );
}

const photoNote = (item: CartItem) => {
  const got = (item.photos || []).length;
  if (item.need) return got >= item.need ? `All ${item.need} photos added` : `${got} of ${item.need} photos added - send the rest after ordering`;
  return got ? `${got} photo${got === 1 ? "" : "s"} added` : "";
};

export function CartDrawer({ closeIcon, arrowIcon, emptyState }: { closeIcon: React.ReactNode; arrowIcon: React.ReactNode; emptyState: React.ReactNode }) {
  const { cart, setQty, removeLine, freeShipOver } = useShop();
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const left = Math.max(0, freeShipOver - total);
  return (
    <ShopDialog id="cart-drawer" className="drawer" labelledBy="cart-title">
      <div className="drawer__panel">
        <div className="drawer__head"><h2 id="cart-title">Your cart</h2><button className="icon-btn" type="button" aria-label="Close cart" data-close>{closeIcon}</button></div>
        <div className="drawer__body" data-cart-body>
          {!cart.length ? emptyState : (
            <>
              <div className="ship-meter">
                {left ? <>You&apos;re <strong>{inr(left)}</strong> away from free shipping</> : <strong>You&apos;ve unlocked free shipping!</strong>}
                <div className="ship-meter__bar"><span style={{ "--p": `${Math.min(100, (total / freeShipOver) * 100)}%` } as React.CSSProperties} /></div>
              </div>
              {cart.map((item, i) => (
                <div className="cart-item" key={item.id}>
                  {item.image ? <img src={item.image} alt="" width={76} height={76} /> : <span />}
                  <div>
                    <h3>{item.name}</h3><p>{item.options}</p>
                    {photoNote(item) && <p className="cart-item__photos">{photoNote(item)}</p>}
                    <div className="cart-item__row">
                      <div className="qty">
                        <button type="button" aria-label="Decrease quantity" data-cart-step="-1" onClick={() => setQty(i, item.qty - 1)}>−</button>
                        <input value={item.qty} aria-label="Quantity" readOnly />
                        <button type="button" aria-label="Increase quantity" data-cart-step="1" onClick={() => setQty(i, item.qty + 1)}>+</button>
                      </div>
                      <button className="link-btn" type="button" data-cart-remove onClick={() => removeLine(i)}>Remove</button>
                    </div>
                  </div>
                  <div className="cart-item__price">{inr(item.price * item.qty)}</div>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="cart-foot" data-cart-foot hidden={!cart.length}>
          <div className="cart-foot__row"><span>Subtotal</span><span data-cart-total>{inr(total)}</span></div>
          <p>Taxes included. Shipping calculated at checkout.</p>
          <a className="btn btn--kiss btn--block" href="/checkout/">Checkout securely {arrowIcon}</a>
        </div>
      </div>
    </ShopDialog>
  );
}
