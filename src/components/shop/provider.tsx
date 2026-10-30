"use client";
// Client-side shop state: cart (localStorage "kp-cart2", read by checkout too), which dialog is open, the toast
// and the wishlist. Everything else on the page stays server-rendered.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type CartPhoto = { key: string; name: string; size: number };
export type CartItem = {
  id: string; slug: string; name: string; image: string; price: number; qty: number;
  options: string; opts: Record<string, string>; note: string; photos: CartPhoto[]; need: number;
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
  toggleWish: (slug: string) => boolean;
  freeShipOver: number;
};

const ShopContext = createContext<Shop | null>(null);
export const CART_KEY = "kp-cart2";

const read = <T,>(key: string, fallback: T): T => {
  try { return (JSON.parse(localStorage.getItem(key) || "null") as T) ?? fallback; } catch { return fallback; }
};
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };

export function ShopProvider({ freeShipOver, children }: { freeShipOver: number; children: React.ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [bump, setBump] = useState(0);
  const [dialog, setDialog] = useState<string | null>(null);
  const [openDialogEl, setOpenDialogEl] = useState<HTMLDialogElement | null>(null);
  const [toast, setToast] = useState<Shop["toast"]>(null);
  const [wish, setWish] = useState<Set<string>>(new Set());
  const loaded = useRef(false);

  // localStorage is read after mount, so server and first client render match (no hydration mismatch).
  useEffect(() => {
    localStorage.removeItem("kp-cart"); // format before structured options existed
    setCart(read<CartItem[]>(CART_KEY, []));
    setWish(new Set(read<string[]>("kp-wish", [])));
    loaded.current = true;
    const sync = (e: StorageEvent) => { if (e.key === CART_KEY) setCart(read<CartItem[]>(CART_KEY, [])); };
    window.addEventListener("storage", sync); // keep several open tabs in step
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => { if (loaded.current) write(CART_KEY, cart); }, [cart]);

  const addToCart = useCallback((item: Omit<CartItem, "id">) => {
    setCart((current) => {
      // Lines with photos stay separate: each one is its own personalised design.
      const same = !item.photos.length && current.findIndex((c) => c.slug === item.slug && c.options === item.options && !c.photos?.length);
      if (same !== false && same >= 0) return current.map((c, i) => (i === same ? { ...c, qty: Math.min(20, c.qty + item.qty) } : c));
      return [...current, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...item }];
    });
    setBump((b) => b + 1);
    setDialog("cart-drawer");
  }, []);
  const setQty = useCallback((index: number, qty: number) => {
    setCart((current) => current.map((c, i) => (i === index ? { ...c, qty: Math.min(20, Math.max(1, qty)) } : c)));
  }, []);
  const removeLine = useCallback((index: number) => setCart((current) => current.filter((_, i) => i !== index)), []);

  const seq = useRef(0);
  const say = useCallback((message: string) => setToast({ message, seq: ++seq.current }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleWish = useCallback((slug: string) => {
    const next = new Set(wish);
    const added = !next.has(slug);
    if (added) next.add(slug);
    else next.delete(slug);
    setWish(next);
    write("kp-wish", [...next]);
    return added;
  }, [wish]);

  const value = useMemo<Shop>(() => ({
    cart, addToCart, setQty, removeLine, bump, dialog, openDialog: setDialog, closeDialog: () => setDialog(null),
    openDialogEl, setOpenDialogEl, toast, say, wish, toggleWish, freeShipOver,
  }), [cart, addToCart, setQty, removeLine, bump, dialog, openDialogEl, toast, say, wish, toggleWish, freeShipOver]);

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
