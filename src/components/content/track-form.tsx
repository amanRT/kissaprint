"use client";
import { useState } from "react";
import { api } from "@/lib/client-api";
import "@/styles/checkout.css";

/** Order number + email/phone -> the customer's order page (the server checks they match). */
export function TrackForm({ arrow }: { arrow: React.ReactNode }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const id = String(data.get("id") || "").trim();
    const contact = String(data.get("contact") || "").trim();
    if (!id || !contact) { setError("Please enter your order number and the email or mobile number you checked out with."); return; }
    setBusy(true);
    setError("");
    try {
      const found = await api<{ id: string; token: string }>("track", { id, contact });
      location.assign(`/order/?id=${encodeURIComponent(found.id)}&t=${encodeURIComponent(found.token)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form className="form" data-track-form noValidate onSubmit={submit}>
      <label>Order number<input className="input" name="id" placeholder="KP-7XK2QD" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} required /></label>
      <label>Email or mobile number used at checkout<input className="input" name="contact" autoComplete="email" maxLength={120} required /></label>
      <p className="co-error" role="alert" data-track-error hidden={!error}>{error}</p>
      <div><button className="btn btn--kiss" type="submit" disabled={busy}>Track order {arrow}</button></div>
    </form>
  );
}
