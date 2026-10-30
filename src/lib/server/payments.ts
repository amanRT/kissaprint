// Razorpay (Orders API + Standard Checkout) and a local stand-in for development.
// Flow: the server creates a Razorpay order for the amount it calculated -> the browser opens Razorpay Checkout
// -> Razorpay returns payment_id + signature -> the server checks HMAC_SHA256(razorpay_order_id|payment_id, key_secret).
// Webhooks are signed the same way over the raw body.
// Docs: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Settings } from "./config";
import type { Order } from "./orders";

/** The payment gateway refused or couldn't be reached. */
export class PaymentError extends Error {}

const sign = (secret: string, message: string | Buffer) => createHmac("sha256", secret).update(message).digest("hex");
const equal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export type RazorpayOrder = { id: string; amount: number; currency?: string; status?: string };

export class Razorpay {
  name: "razorpay" | "mock" = "razorpay";
  static API = "https://api.razorpay.com/v1";
  constructor(protected keyId: string, protected keySecret: string, protected webhookSecret = "") {}

  protected async call<T>(method: string, path: string, body?: unknown, timeoutMs = 12000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(Razorpay.API + path, {
        method, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
      });
    } catch {
      throw new PaymentError("Couldn't reach Razorpay - please try again");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (data as { error?: { description?: string } }).error?.description;
      throw new PaymentError(`Razorpay error ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return data as T;
  }

  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
    return this.call<RazorpayOrder>("POST", "/orders", { amount: amountPaise, currency: "INR", receipt, notes });
  }

  fetchPayment(paymentId: string) {
    return this.call<Record<string, unknown>>("GET", `/payments/${encodeURIComponent(paymentId)}`, undefined, 6000);
  }

  verifyPayment(razorpayOrderId: string, paymentId: string, signature: unknown) {
    return equal(sign(this.keySecret, `${razorpayOrderId}|${paymentId}`), String(signature ?? ""));
  }

  verifyWebhook(rawBody: Buffer, signature: string) {
    return Boolean(this.webhookSecret) && equal(sign(this.webhookSecret, rawBody), signature);
  }

  /** Options for `new Razorpay(options)` in the browser (the key ID is public by design). */
  checkoutOptions(order: Order, rzp: RazorpayOrder, image: string): Record<string, unknown> {
    const c = order.customer;
    return {
      gateway: this.name, key: this.keyId, order_id: rzp.id, amount: rzp.amount, currency: "INR", name: "KissaPrints",
      description: `Order ${order.id}`, image, prefill: { name: c.name, email: c.email, contact: "+91" + c.phone },
      notes: { kp_order: order.id }, theme: { color: "#d7263d" },
    };
  }
}

/** Local development only: behaves like Razorpay without talking to it. Never enabled on Vercel. */
export class MockGateway extends Razorpay {
  constructor() {
    super("mock_key", "kissaprints-local-mock-secret");
    this.name = "mock";
  }
  async createOrder(amountPaise: number): Promise<RazorpayOrder> {
    return { id: "order_mock" + randomBytes(7).toString("hex"), amount: amountPaise, currency: "INR", status: "created" };
  }
  async fetchPayment(paymentId: string) {
    return { id: paymentId, method: "upi", status: "captured" };
  }
  checkoutOptions(order: Order, rzp: RazorpayOrder, image: string) {
    // The fake "payment page" in the checkout sends these back exactly as Razorpay would.
    const payId = "pay_mock" + randomBytes(7).toString("hex");
    return { ...super.checkoutOptions(order, rzp, image), mock: { razorpay_payment_id: payId, razorpay_order_id: rzp.id, razorpay_signature: sign(this.keySecret, `${rzp.id}|${payId}`) } };
  }
}

/** The payment fields worth keeping on the order (method, UPI ID, card network/last 4...). */
export function slimPayment(payment: Record<string, unknown> | null, paymentId: string): Record<string, unknown> {
  if (!payment) return { id: paymentId };
  const keep = Object.fromEntries(["id", "method", "status", "amount", "vpa", "bank", "wallet", "created_at"].filter((k) => payment[k] != null).map((k) => [k, payment[k]]));
  const card = payment.card as Record<string, unknown> | undefined;
  if (card) keep.card = Object.fromEntries(["network", "last4", "type"].filter((k) => card[k]).map((k) => [k, card[k]]));
  return keep;
}

export function gateway(cfg: Settings): Razorpay | null {
  if (cfg.payments === "razorpay") return new Razorpay(cfg.razorpayKeyId, cfg.razorpayKeySecret, cfg.razorpayWebhookSecret);
  if (cfg.payments === "mock") return new MockGateway();
  return null;
}
