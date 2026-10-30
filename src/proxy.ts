import { NextResponse, type NextRequest } from "next/server";
import { clearedCookie, safeNext, SESSION_COOKIE, verifySession } from "@/lib/server/session";

// The middleware (Next.js 16 names the file proxy.ts; it used to be middleware.ts). It intercepts every request to
// the protected routes below and verifies the JWT in the session cookie (signature, expiry, issuer, audience):
//   no token, or one that doesn't verify -> the cookie is removed and the visitor goes to /login/?next=...
//                                           (API routes answer 401 JSON instead, since a fetch can't show a page)
//   /admin, /api/admin                   -> admins only (isAdmin in the token); a signed-in customer is sent to the
//                                           homepage (APIs: 403)
//   /checkout and the checkout APIs      -> any signed-in user: log in before checking out
//   /account, cart saving, photo uploads -> any signed-in user
//   /login, /signup                      -> signed-in users skip straight to where they were going
// Pages and route handlers check again (and re-read is_admin and the token version from the database), so a
// matcher change can never open them up on its own.
const noStore = { "Cache-Control": "no-store" };

const ADMIN = ["/admin", "/api/admin"];
const SIGNED_IN = ["/account", "/checkout", "/api/orders", "/api/quote", "/api/verify", "/api/cart", "/api/uploads"];
const under = (pathname: string, roots: string[]) => roots.some((r) => pathname === r || pathname.startsWith(`${r}/`));

export async function proxy(req: NextRequest) {
  const { pathname, search, searchParams } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const claims = await verifySession(token);
  const api = pathname.startsWith("/api/");
  const secure = req.nextUrl.protocol === "https:";

  if (under(pathname, ["/login", "/signup"])) {
    if (!claims || searchParams.has("expired")) return clean(NextResponse.next(), token, secure);
    return NextResponse.redirect(new URL(safeNext(searchParams.get("next"), claims.isAdmin ? "/admin/" : "/account/"), req.url));
  }
  // Reading the cart is allowed signed out (it answers {signedIn: false}), so pages don't log a 401 for visitors.
  if (!claims && pathname.startsWith("/api/cart") && req.method === "GET") return clean(NextResponse.next(), token, secure);

  if (!claims && (under(pathname, ADMIN) || under(pathname, SIGNED_IN))) {
    if (api) return clean(NextResponse.json({ error: "Please log in" }, { status: 401, headers: noStore }), token, secure);
    const login = new URL("/login/", req.url);
    login.searchParams.set("next", pathname + search);
    return clean(NextResponse.redirect(login), token, secure);
  }
  if (claims && under(pathname, ADMIN) && !claims.isAdmin) {
    if (api) return NextResponse.json({ error: "Admins only" }, { status: 403, headers: noStore });
    return NextResponse.redirect(new URL("/", req.url)); // customers go back to the shop
  }
  return NextResponse.next();
}

/** A cookie that's there but doesn't verify (tampered, expired, signed with an old secret) is removed. */
function clean(res: NextResponse, token: string | undefined, secure: boolean) {
  if (token) res.cookies.set(clearedCookie(secure));
  return res;
}

export const config = {
  matcher: [
    "/admin/:path*", "/api/admin/:path*", "/account/:path*", "/checkout/:path*",
    "/api/orders/:path*", "/api/quote/:path*", "/api/verify/:path*", "/api/cart/:path*", "/api/uploads/:path*",
    "/login/:path*", "/signup/:path*",
  ],
};
