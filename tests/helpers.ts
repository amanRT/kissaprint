// Test helpers: a fresh local store + settings per test, and a way to call route handlers like the browser does.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

export const CUSTOMER = { name: "Aman Test", phone: "+91 98765 43210", email: "Aman@Example.com" };
export const ADDRESS = { line1: "Flat 4B, Rose Apartments", line2: "MG Road", city: "Pune", state: "Maharashtra", pincode: "411001" };
export const PHOTO = { key: `up/20261029/${"a".repeat(32)}.jpg`, name: "IMG_1.jpg", size: 1234 };
export const SECRET = "test-jwt-secret-that-is-long-enough-123456";

const KEYS = /^(RAZORPAY_|SUPABASE_|NEXT_PUBLIC_SUPABASE|VERCEL|JWT_SECRET|TEST_PHONES|KP_DATA_DIR)/;

/** Fresh .data dir and a clean environment (mock payments, local store, known JWT secret) for every test. */
export function useTestEnv(extra: Record<string, string> = {}) {
  let dir = "";
  let saved = process.env;
  beforeEach(() => {
    saved = { ...process.env };
    for (const k of Object.keys(process.env)) if (KEYS.test(k)) delete process.env[k];
    dir = mkdtempSync(join(tmpdir(), "kp-test-"));
    Object.assign(process.env, { KP_DATA_DIR: dir, JWT_SECRET: SECRET, ...extra });
  });
  afterEach(() => {
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  });
  return () => dir;
}

type Handler = (req: Request) => Promise<Response>;
type CallOptions = { body?: unknown; raw?: BodyInit; cookie?: string; headers?: Record<string, string> };

export async function call(handler: Handler, method: string, path: string, { body, raw, cookie, headers = {} }: CallOptions = {}) {
  const init: RequestInit = { method, headers: { ...(body !== undefined && !("content-type" in headers) ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers } };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handler(new Request(`http://localhost${path}`, init));
  const text = await res.text();
  let data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

/** "kp_session=<jwt>" from a response's Set-Cookie header, ready to send back as a Cookie header. */
export const sessionFrom = (headers: Headers) => (headers.get("set-cookie") ?? "").split(";")[0];

/** Sign up a fresh shopper and return their session cookie (ordering needs an account). */
export async function shopperCookie() {
  const { POST: signup } = await import("@/app/api/auth/signup/route");
  const res = await call(signup, "POST", "/api/auth/signup/", { body: { name: "Aman Test", email: `shopper-${randomUUID()}@example.com`, password: "shopper-pass-1" } });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.data)}`);
  return sessionFrom(res.headers);
}
