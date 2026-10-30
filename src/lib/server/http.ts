// Route-handler plumbing: JSON responses, error mapping and per-request access to settings, store and gateway.
import { NextResponse } from "next/server";
import { settings, type Settings } from "./config";
import { FieldError } from "./orders";
import { gateway, PaymentError, type Razorpay } from "./payments";
import { CartError } from "./pricing";
import { SESSION_COOKIE, verifySession, type SessionClaims } from "./session";
import { makeStore, StoreError, type Store, type User } from "./store";

export class ApiError extends Error {
  constructor(public status: number, message: string, public field?: string) { super(message); }
}

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });

const log = (...parts: unknown[]) => console.error("[kissaprints]", ...parts);

export class Ctx {
  cfg: Settings = settings();
  private storeInst: Store | null | undefined;
  private gatewayInst: Razorpay | null | undefined;
  constructor(public req: Request) {}

  get store(): Store {
    this.storeInst ??= makeStore(this.cfg);
    if (!this.storeInst) throw new ApiError(503, "Orders aren't switched on yet - the shop owner needs to connect Supabase");
    return this.storeInst;
  }
  get gateway(): Razorpay {
    this.gatewayInst ??= gateway(this.cfg);
    if (!this.gatewayInst) throw new ApiError(503, "Online payments aren't switched on yet - the shop owner needs to add Razorpay keys");
    return this.gatewayInst;
  }
  /** Stored on each order: 'razorpay' (live keys), 'razorpay_test' or 'mock'. The last two are test orders. */
  get gatewayLabel() {
    const name = this.gateway.name;
    return name !== "razorpay" ? name : this.cfg.testMode ? "razorpay_test" : "razorpay";
  }
  get url() { return new URL(this.req.url); }
  get query() { return this.url.searchParams; }
  get secure() { return this.url.protocol === "https:" || this.req.headers.get("x-forwarded-proto") === "https"; }
  get origin() {
    const host = this.req.headers.get("x-forwarded-host") || this.req.headers.get("host") || "localhost";
    return `${this.secure ? "https" : "http"}://${host}`;
  }

  async body(): Promise<Record<string, unknown>> {
    const raw = await this.req.text();
    if (!raw) return {};
    if (!(this.req.headers.get("content-type") || "").includes("json")) throw new ApiError(415, "Send JSON"); // also stops cross-site form posts
    if (raw.length > 512 * 1024) throw new ApiError(413, "That request is too large");
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new ApiError(400, "Invalid JSON"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(400, "Expected a JSON object");
    return data as Record<string, unknown>;
  }

  /** The signed-in user's claims (signature + expiry checked), or null. */
  async session(): Promise<SessionClaims | null> {
    const cookie = this.req.headers.get("cookie") || "";
    const token = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    return verifySession(token ? decodeURIComponent(token) : null);
  }

  /** Any signed-in user, re-checked against the database (deleted users and revoked tokens are refused). */
  async requireUser(): Promise<User> {
    const claims = await this.session();
    if (!claims) throw new ApiError(401, "Please log in");
    const user = await this.store.getUserById(claims.sub);
    if (!user || user.token_version !== claims.tv) throw new ApiError(401, "Your session has ended - please log in again");
    return user;
  }

  /** Admins only. The token says isAdmin, and the database must still agree (is_admin can be revoked any time). */
  async requireAdmin(): Promise<User> {
    const claims = await this.session();
    if (!claims) throw new ApiError(401, "Please log in");
    if (!claims.isAdmin) throw new ApiError(403, "Admins only");
    const user = await this.requireUser();
    if (!user.is_admin) throw new ApiError(403, "Admins only");
    return user;
  }
}

type Handler = (ctx: Ctx) => Promise<Response>;

/** Wraps a route handler: known errors become JSON with the right status; nothing leaks a stack trace. */
export function handle(fn: Handler) {
  return async (req: Request) => {
    try {
      return await fn(new Ctx(req));
    } catch (err) {
      if (err instanceof ApiError) return json({ error: err.message, ...(err.field && { field: err.field }) }, err.status);
      if (err instanceof FieldError) return json({ error: err.message, field: err.field }, 400);
      if (err instanceof CartError) return json({ error: err.message }, 400);
      if (err instanceof PaymentError) { log("payment gateway:", err.message); return json({ error: err.message }, 502); }
      if (err instanceof StoreError) { log("store:", err.message); return json({ error: "Our order system is having a moment - please try again in a minute" }, 503); }
      log(err);
      return json({ error: "Something went wrong on our side - please try again" }, 500);
    }
  };
}

export const publicUser = (u: Pick<User, "id" | "email" | "name" | "is_admin">) => ({ id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin });
export { log };
