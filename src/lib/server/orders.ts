// Order records: checkout validation, IDs, status flow and the views shown to customers and the team.
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { states } from "../catalog";
import type { OrderPhoto, PricedLine, Quote } from "./pricing";

// Order life cycle. "pending" = created at checkout, waiting for payment.
export const STATUSES = ["pending", "paid", "printing", "shipped", "delivered", "cancelled", "refunded"] as const;
export type Status = (typeof STATUSES)[number];
export const CUSTOMER_LABELS: Record<Status, string> = {
  pending: "Awaiting payment", paid: "Order confirmed", printing: "Being printed",
  shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled", refunded: "Refunded",
};
export const PAID: Status[] = ["paid", "printing", "shipped", "delivered"];
/** Orders the customer sees under "Your orders": only ones that were actually paid (or a team test order). A checkout
 *  that was opened and then cancelled stays out - the shopper still has everything in their cart, and the team
 *  sees the attempt in the admin's Unpaid tab. */
export const wasPaid = (o: Pick<Order, "history">) => (o.history ?? []).some((h) => h.status === "paid");
// Test orders: local stand-in, Razorpay test keys, or a team test account (users.is_tester) - no real money moved.
export const TEST_GATEWAYS = ["mock", "razorpay_test", "bypass"];
export const ORDER_ID = /^KP-[2-9A-HJ-NP-Z]{6}$/;
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O or 1/I - easy to read out on the phone
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PINCODE = /^[1-9][0-9]{5}$/;

export type Customer = { name: string; phone: string; email: string };
export type Address = { line1: string; line2: string; city: string; state: string; pincode: string };
export type HistoryEntry = { at: string; status: Status; note?: string };
export type Tracking = { courier: string; number: string; url: string } | null;
export type Order = {
  id: string; created_at: string; updated_at: string; status: Status;
  customer: Customer; address: Address; items: PricedLine[];
  subtotal: number; shipping: number; total: number; currency: "INR";
  gateway: string; razorpay_order_id: string | null; razorpay_payment_id: string | null;
  payment: Record<string, unknown> | null; tracking: Tracking; notes: string; history: HistoryEntry[];
  token: string; user_id: string | null;
};

/** A checkout field that needs fixing; `field` names the input so the page can highlight it. */
export class FieldError extends Error {
  constructor(public field: string, message: string) { super(message); }
}

export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
export const newOrderId = () => "KP-" + Array.from({ length: 6 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join("");
export const isTest = (order: Pick<Order, "gateway">) => TEST_GATEWAYS.includes(order.gateway);

/** Constant-time comparison that also copes with non-ASCII input. */
export function same(a: unknown, b: unknown): boolean {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Indian mobile number -> 10 digits. Accepts +91 / 91 / 0 prefixes, spaces and dashes. */
export function normalisePhone(raw: unknown): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : "";
}

function text(data: Record<string, unknown>, field: string, label: string, lo: number, hi: number, required = true) {
  const value = String(data[field] ?? "").replace(/\s+/g, " ").trim();
  if (!value && !required) return "";
  if (value.length < lo) throw new FieldError(field, `Please enter your ${label}`);
  if (value.length > hi) throw new FieldError(field, `Your ${label} is too long (max ${hi} characters)`);
  return value;
}

export function cleanContact(customer: unknown): Customer {
  if (!customer || typeof customer !== "object") throw new FieldError("name", "Please fill in your contact details");
  const c = customer as Record<string, unknown>;
  const name = text(c, "name", "full name", 2, 80);
  const phone = normalisePhone(c.phone);
  if (!phone) throw new FieldError("phone", "Please enter a valid 10-digit mobile number");
  const email = String(c.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 120) throw new FieldError("email", "Please enter a valid email address");
  return { name, phone, email };
}

export function cleanAddress(address: unknown): Address {
  if (!address || typeof address !== "object") throw new FieldError("line1", "Please fill in your delivery address");
  const a = address as Record<string, unknown>;
  const clean: Address = {
    line1: text(a, "line1", "flat / house number and building", 3, 120),
    line2: text(a, "line2", "area or street", 0, 120, false),
    city: text(a, "city", "city", 2, 60),
    state: String(a.state ?? "").trim(),
    pincode: String(a.pincode ?? "").replace(/\s/g, ""),
  };
  if (!states.includes(clean.state)) throw new FieldError("state", "Please choose your state");
  if (!PINCODE.test(clean.pincode)) throw new FieldError("pincode", "Please enter a valid 6-digit pincode");
  return clean;
}

export function newOrder(q: Quote, customer: Customer, address: Address, gateway: string, userId: string | null): Order {
  const stamp = now();
  return {
    id: newOrderId(), created_at: stamp, updated_at: stamp, status: "pending", customer, address, items: q.lines,
    subtotal: q.subtotal, shipping: q.shipping, total: q.total, currency: "INR", gateway,
    razorpay_order_id: null, razorpay_payment_id: null, payment: null, tracking: null, notes: "",
    history: [{ at: stamp, status: "pending", note: "Order placed, awaiting payment" }],
    token: randomBytes(18).toString("base64url"), // secret for the customer's order link (the ID alone isn't enough)
    user_id: userId,
  };
}

/** Changes for a status update, with the history entry appended. */
export function withStatus(order: Order, status: Status, note = "", changes: Partial<Order> = {}): Partial<Order> {
  const stamp = now();
  const entry: HistoryEntry = note ? { at: stamp, status, note } : { at: stamp, status };
  return { ...changes, status, updated_at: stamp, history: [...(order.history ?? []), entry] };
}

const METHODS: Record<string, string> = { upi: "UPI", card: "card", netbanking: "net banking", wallet: "wallet", emi: "EMI", cardless_emi: "cardless EMI", paylater: "pay later" };

export function markPaidChanges(order: Order, paymentId: string, payment: Record<string, unknown> | null, via: string) {
  const method = METHODS[String(payment?.method ?? "")] ?? "";
  return withStatus(order, "paid", `Payment received${method ? ` by ${method}` : ""} (${via})`, { razorpay_payment_id: paymentId, payment: payment ?? { id: paymentId } });
}

export type Refund = { id: string; amount: number; status: string; at: string };

/** Razorpay refund event -> changes to the order, or null if there's nothing new (duplicate delivery).
 *  Refunds are kept in order.payment.refunds (amounts in rupees); a full refund moves the order to "refunded". */
export function refundChanges(order: Order, kind: string, refund: { id?: unknown; amount?: unknown; status?: unknown }, refundedPaise: number): Partial<Order> | null {
  const id = String(refund.id ?? "");
  if (!id) return null;
  const pay = (order.payment ?? {}) as Record<string, unknown> & { refunds?: Refund[] };
  const refunds = pay.refunds ?? [];
  const status = kind === "refund.processed" ? "processed" : kind === "refund.failed" ? "failed" : "created";
  const known = refunds.find((r) => r.id === id);
  if (known && (known.status === status || known.status === "processed")) return null; // already recorded
  const amount = Math.round(Number(refund.amount ?? 0)) / 100;
  const entry: Refund = { id, amount, status, at: now() };
  const payment = { ...pay, refunds: [...refunds.filter((r) => r.id !== id), entry], amount_refunded: Math.round(refundedPaise) / 100 };
  const rupees = `₹${amount.toLocaleString("en-IN")}`;
  if (status === "processed" && refundedPaise >= order.total * 100) {
    return withStatus(order, "refunded", `Refunded ${rupees} in full (Razorpay ${id})`, { payment });
  }
  const note = status === "processed" ? `Partial refund of ${rupees} processed (Razorpay ${id})`
    : status === "failed" ? `Refund of ${rupees} FAILED - check Razorpay (${id})` : `Refund of ${rupees} started (Razorpay ${id})`;
  return withStatus(order, order.status, note, { payment });
}

export function contactMatches(order: Order, contact: unknown): boolean {
  const raw = String(contact ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.includes("@")) return same(raw, order.customer.email);
  const phone = normalisePhone(raw);
  return Boolean(phone) && same(phone, order.customer.phone);
}

/** Timeline for customers: one entry per status change (failed payment retries etc. collapse). */
const steps = (history: HistoryEntry[]) => history.reduce<{ at: string; status: Status }[]>((acc, h) => {
  if (!acc.length || acc[acc.length - 1].status !== h.status) acc.push({ at: h.at, status: h.status });
  return acc;
}, []);

/** What the customer sees on their order page. */
export const customerView = (o: Order) => ({
  id: o.id, status: o.status, status_label: CUSTOMER_LABELS[o.status], created_at: o.created_at, name: o.customer.name.split(" ")[0],
  items: o.items.map((l) => ({ name: l.name, options: l.options, note: l.note, qty: l.qty, line_total: l.line_total, photos: l.photos.length, photos_needed: l.photos_needed })),
  subtotal: o.subtotal, shipping: o.shipping, total: o.total, address: o.address, tracking: o.tracking, history: steps(o.history ?? []),
});
export type CustomerView = ReturnType<typeof customerView>;

export const adminSummary = (o: Order) => ({
  id: o.id, created_at: o.created_at, status: o.status, name: o.customer.name, phone: o.customer.phone,
  city: o.address.city, state: o.address.state, total: o.total, items: o.items.map((l) => `${l.name} ×${l.qty}`),
  // Quantity 2 means two copies of the same design, so it needs the photos once.
  photos: o.items.reduce((n, l) => n + l.photos.length, 0), photos_needed: o.items.reduce((n, l) => n + l.photos_needed, 0),
  gateway: o.gateway, test: isTest(o),
});
export type AdminSummary = ReturnType<typeof adminSummary>;
export type { OrderPhoto };
