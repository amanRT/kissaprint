"use client";
// Small interactive pieces of the shop chrome. Their visible markup comes from server components as children.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShop } from "./provider";

/** <header> that gains .is-stuck (shadow) once the announcement bar scrolls away. No scroll listeners. */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const bar = document.querySelector(".announce");
    if (!bar || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting));
    io.observe(bar);
    return () => io.disconnect();
  }, []);
  return <header className={stuck ? "site-header is-stuck" : "site-header"} data-header>{children}</header>;
}

/** A nav item with a mega-menu panel: hover opens it (CSS); click/tap and keyboard toggle .is-open. */
export function MegaItem({ label, panelId, children }: { label: React.ReactNode; panelId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [open]);
  return (
    <li ref={ref} className={open ? "nav__item is-open" : "nav__item"} data-mega onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { setOpen(false); ref.current?.querySelector("button")?.focus(); } }}>
      <button className="nav__link" type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>{label}</button>
      {children}
    </li>
  );
}

export function OpenButton({ dialog, className, label, children }: { dialog: string; className: string; label: string; children: React.ReactNode }) {
  const { openDialog } = useShop();
  return <button className={className} type="button" aria-label={label} aria-haspopup="dialog" data-open={dialog} onClick={() => openDialog(dialog)}>{children}</button>;
}

export function CartButton({ children }: { children: React.ReactNode }) {
  const { cart, bump, openDialog } = useShop();
  const count = cart.reduce((n, item) => n + item.qty, 0);
  return (
    <button className="icon-btn" type="button" aria-label="Open cart" aria-haspopup="dialog" data-open="cart-drawer" onClick={() => openDialog("cart-drawer")}>
      {children}
      <span key={bump} className={bump ? "cart-count is-bump" : "cart-count"} data-cart-count hidden={count === 0}>{count}</span>
    </button>
  );
}

/** The toast lives inside an open modal dialog when there is one (modal dialogs sit above everything else). */
export function Toast({ children }: { children: React.ReactNode }) {
  const { toast, openDialogEl } = useShop();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const el = (
    <div className={toast ? "toast is-visible" : "toast"} data-toast role="status" aria-live="polite">
      {children}<span data-toast-msg>{toast?.message}</span>
    </div>
  );
  return mounted ? createPortal(el, openDialogEl ?? document.body) : null;
}

export function CarouselButtons({ target, prevIcon, nextIcon }: { target: string; prevIcon: React.ReactNode; nextIcon: React.ReactNode }) {
  const scroll = (dir: number) => {
    const track = document.getElementById(target);
    if (!track) return;
    const first = track.firstElementChild;
    const step = first ? first.getBoundingClientRect().width + 16 : track.clientWidth * 0.8;
    track.scrollBy({ left: dir * step, behavior: "smooth" });
  };
  return (
    <div className="carousel-nav hide-mobile">
      <button className="round-btn" type="button" aria-label="Previous reviews" onClick={() => scroll(-1)}>{prevIcon}</button>
      <button className="round-btn" type="button" aria-label="Next reviews" onClick={() => scroll(1)}>{nextIcon}</button>
    </div>
  );
}

/** Static-site forms that only confirm on screen for now (newsletter, contact, bulk orders). */
export function DemoForm({ className, done, children }: { className: string; done: string; children: React.ReactNode }) {
  const [sent, setSent] = useState(false);
  if (sent) {
    return <p className="form-done" role="status"><svg className="icon" aria-hidden="true"><use href="#i-check" /></svg>{done}</p>;
  }
  return <form className={className} onSubmit={(e) => { e.preventDefault(); setSent(true); }}>{children}</form>;
}
