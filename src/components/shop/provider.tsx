"use client";
// Client-side shop state: the cart and wishlist (kept on the shopper's account via /api/cart/ - nothing is stored in
// the browser), whether they're signed in, which dialog is open and the toast. Everything else stays server-rendered.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, type ApiError } from "@/lib/client-api";
import type { Layout } from "@/lib/magazine";

export type CartPhoto = { key: string; name: string; size: number };
export type CartItem = {
  id: string; slug: string; name: string; image: string; price: number; qty: number;
  options: string; opts: Record<string, string>; note: string; photos: CartPhoto[]; need: number;
  /** Designed products (the magazine): which photo goes in which spot. */
  layout?: Layout;
};

type Shop = {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, "id">) => void;
  setQty: (index: number, qty: number) => void;
  removeLine: (index: number) => void;
  bump: number; // increments on add, so the header badge can animate
  dialog: string | null;
  openDialog: (id: string) => void;
  closeDialog: () => void;
  openDialogEl: HTMLDialogElement | null;
  setOpenDialogEl: (el: HTMLDialogElement | null) => void;
  toast: { message: string; seq: number } | null;
  say: (message: string) => void;
  wish: Set<string>;
  /** false (and nothing changes) when signed out - the wishlist lives on the account. */
  toggleWish: (slug: string) => boolean;
  /** "out" = signed out: personalising and ordering need an account. */
  account: "loading" | "in" | "out";
  /** After checkout: empty the cart on the account before leaving the page. */
  clearCart: () => Promise<void>;
  freeShipOver: number;
};

const ShopContext = createContext<Shop | null>(null);
// What earlier versions kept in localStorage (cart, wishlist, checkout details) - wiped on load.
const OLD_KEYS = ["kp-cart", "kp-cart2", "kp-wish", "kp-checkout"];
type CartRes = { signedIn: boolean; items: CartItem[]; wishlist: string[] };
const loginHere = () => location.assign(`/login/?next=${encodeURIComponent(location.pathname + location.search)}`);

export function ShopProvider({ freeShipOver, children }: { freeShipOver: number; children: React.ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [bump, setBump] = useState(0);
  const [dialog, setDialog] = useState<string | null>(null);
  const [openDialogEl, setOpenDialogEl] = useState<HTMLDialogElement | null>(null);
  const [toast, setToast] = useState<Shop["toast"]>(null);
  const [wish, setWish] = useState<Set<string>>(new Set());
  const [account, setAccount] = useState<Shop["account"]>("loading");
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const cartRef = useRef<CartItem[]>([]);
  const dirty = useRef(false);

  // Load the account's cart after mount (so server and first client render match). 401 = the session just ended.
  const load = useCallback(() => {
    if (dirty.current) return; // a save is on its way; don't overwrite it with older data
    api<CartRes>("/api/cart/").then((r) => { cartRef.current = r.items; setCart(r.items); setWish(new Set(r.wishlist)); setAccount(r.signedIn ? "in" : "out"); })
      .catch((err) => { if ((err as ApiError).status === 401) { cartRef.current = []; setCart([]); setWish(new Set()); setAccount("out"); } });
  }, []);
  useEffect(() => {
    try { OLD_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    load();
    const again = () => { if (document.visibilityState === "visible") load(); }; // keep several open tabs in step
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [load]);

  const seq = useRef(0);
  const say = useCallback((message: string) => setToast({ message, seq: ++seq.current }), []);
  // Every change goes to the account, one request at a time, latest last.
  const save = useCallback((changes: { items?: CartItem[]; wishlist?: string[] }) => {
    dirty.current = true;
    const run = saving.current.then(() => api("/api/cart/", changes, { method: "PUT" })).catch((err) => {
      if ((err as ApiError).status === 401) setAccount("out");
      else say("Couldn't save your cart just now - please try again"); // never fail silently
    }).finally(() => { if (saving.current === run) dirty.current = false; });
    saving.current = run;
    return run;
  }, [say]);
  const change = useCallback((fn: (c: CartItem[]) => CartItem[]) => {
    const next = fn(cartRef.current);
    cartRef.current = next;
    setCart(next);
    void save({ items: next });
  }, [save]);

  const addToCart = useCallback((item: Omit<CartItem, "id">) => {
    if (account === "out") { loginHere(); return; }
    change((current) => {
      // Lines with photos stay separate: each one is its own personalised design.
      const same = !item.photos.length && current.findIndex((c) => c.slug === item.slug && c.options === item.options && !c.photos?.length);
      if (same !== false && same >= 0) return current.map((c, i) => (i === same ? { ...c, qty: Math.min(20, c.qty + item.qty) } : c));
      return [...current, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...item }];
    });
    setBump((b) => b + 1);
    setDialog("cart-drawer");
  }, [account, change]);
  const setQty = useCallback((index: number, qty: number) => {
    change((current) => current.map((c, i) => (i === index ? { ...c, qty: Math.min(20, Math.max(1, qty)) } : c)));
  }, [change]);
  const removeLine = useCallback((index: number) => change((current) => current.filter((_, i) => i !== index)), [change]);
  const clearCart = useCallback(async () => { cartRef.current = []; setCart([]); await save({ items: [] }); }, [save]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleWish = useCallback((slug: string) => {
    if (account !== "in") return false;
    const next = new Set(wish);
    const added = !next.has(slug);
    if (added) next.add(slug);
    else next.delete(slug);
    setWish(next);
    void save({ wishlist: [...next] });
    return added;
  }, [wish, account, save]);

  const value = useMemo<Shop>(() => ({
    cart, addToCart, setQty, removeLine, bump, dialog, openDialog: setDialog, closeDialog: () => setDialog(null),
    openDialogEl, setOpenDialogEl, toast, say, wish, toggleWish, account, clearCart, freeShipOver,
  }), [cart, addToCart, setQty, removeLine, bump, dialog, openDialogEl, toast, say, wish, toggleWish, account, clearCart, freeShipOver]);

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): Shop {
  const shop = useContext(ShopContext);
  if (!shop) throw new Error("useShop() must be used inside <ShopProvider>");
  return shop;
}

/** A modal <dialog> driven by the shop's `dialog` state (search, cart, mobile menu). */
export function ShopDialog({ id, className, label, labelledBy, children }: { id: string; className: string; label?: string; labelledBy?: string; children: React.ReactNode }) {
  const { dialog, closeDialog, setOpenDialogEl } = useShop();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (dialog === id && !el.open) {
      el.showModal();
      setOpenDialogEl(el);
      document.documentElement.classList.add("modal-open");
    } else if (dialog !== id && el.open) {
      el.close();
    }
  }, [dialog, id, setOpenDialogEl]);
  return (
    <dialog
      ref={ref} id={id} className={className} aria-label={label} aria-labelledby={labelledBy}
      onClose={() => {
        setOpenDialogEl(null);
        document.documentElement.classList.toggle("modal-open", Boolean(document.querySelector("dialog[open]")));
        if (dialog === id) closeDialog();
      }}
      onClick={(e) => { if (e.target === e.currentTarget || (e.target as Element).closest("[data-close]")) closeDialog(); }}
    >
      {children}
    </dialog>
  );
}
