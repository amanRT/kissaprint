"use client";
// Log-in / sign-up forms. On success the server has already set the HttpOnly session cookie (a JWT with
// userId + isAdmin); we only navigate on. Admins land on /admin/, everyone else on /account/ (or ?next=).
import { useEffect, useState } from "react";
import { api, type ApiError } from "@/lib/client-api";
import "@/styles/checkout.css";

type User = { id: string; email: string; name: string; isAdmin: boolean };
const safeNext = (next: string | null, fallback: string) => (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback);

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget; // React clears currentTarget once the handler awaits
    const form = new FormData(formEl);
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: User }>(signup ? "auth/signup" : "auth/login", Object.fromEntries(form));
      location.assign(safeNext(new URLSearchParams(location.search).get("next"), user.isAdmin ? "/admin/" : "/account/"));
    } catch (err) {
      const ae = err as ApiError;
      setError({ message: ae.message, field: ae.field });
      setBusy(false);
      if (ae.field) (formEl.elements.namedItem(ae.field) as HTMLInputElement | null)?.focus();
    }
  };
  const invalid = (name: string) => (error?.field === name ? true : undefined);

  return (
    <form className="form" onSubmit={submit} noValidate>
      {signup && <label>Your name<input className="input" name="name" autoComplete="name" maxLength={80} required aria-invalid={invalid("name")} /></label>}
      <label>Email<input className="input" type="email" name="email" autoComplete="email" maxLength={120} required aria-invalid={invalid("email")} /></label>
      <label>Password{signup && <span className="co-optional"> (at least 8 characters)</span>}
        <input className="input" type="password" name="password" autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 8 : undefined} required aria-invalid={invalid("password")} />
      </label>
      <p className="co-error" role="alert" hidden={!error}>{error?.message}</p>
      <button className="btn btn--kiss btn--block" type="submit" disabled={busy}>{busy ? "Just a moment…" : signup ? "Create account" : "Log in"}</button>
    </form>
  );
}

/** On the way to checkout (?next=/checkout/): say why we're asking, and that the cart is safe. */
export function CheckoutNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow((new URLSearchParams(location.search).get("next") || "").startsWith("/checkout")); }, []);
  if (!show) return null;
  return <p className="auth__notice" role="status">Log in or create an account to place your order. Your cart is saved and you&apos;ll go straight back to checkout.</p>;
}

/** Keeps ?next= when switching between the log-in and sign-up pages. */
export function SwitchLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} onClick={(e) => { e.preventDefault(); location.assign(href + location.search); }}>{children}</a>;
}

export function LogoutButton({ everywhere = false, className = "btn btn--ghost btn--sm", children }: { everywhere?: boolean; className?: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className={className} type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      await api("auth/logout", everywhere ? { everywhere: true } : {}).catch(() => {});
      location.assign("/login/");
    }}>{children}</button>
  );
}
