// Runs once when the Next.js server starts. The Node-only module is imported behind the runtime check, so
// the Edge build (which has no node:dns) drops it entirely.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./lib/server/ipv4-first");
}
