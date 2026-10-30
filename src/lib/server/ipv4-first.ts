// Local machines only (never on Vercel): look up IPv4 addresses first for outgoing calls (Supabase, Razorpay).
// Some home routers stall ~11 s on IPv6 (AAAA) lookups, which made every local Supabase call painfully slow.
// Loaded from src/instrumentation.ts when the server starts.
import dns from "node:dns";

type Lookup = (...args: unknown[]) => void;
const target = dns as unknown as { lookup: Lookup & { kpIpv4First?: boolean } };

if (!process.env.VERCEL && !target.lookup.kpIpv4First) {
  const original = target.lookup;
  const patched: Lookup & { kpIpv4First?: boolean } = (hostname, options, callback) => {
    if (typeof options === "function") { callback = options; options = {}; }
    const opts = typeof options === "number" ? { family: options } : { ...(options as object) };
    const cb = callback as Lookup;
    if ((opts as { family?: number }).family) { original(hostname, opts, cb); return; }
    original(hostname, { ...opts, family: 4 }, (err: unknown, ...rest: unknown[]) => {
      if (!err) cb(null, ...rest);
      else original(hostname, opts, cb); // IPv6-only host: fall back to the normal lookup
    });
  };
  patched.kpIpv4First = true;
  target.lookup = patched;
}
