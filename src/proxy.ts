import { NextResponse, type NextRequest } from "next/server";
import { safeNext, SESSION_COOKIE, verifySession } from "@/lib/server/session";

// First line of defence for the protected areas, checked on every request (the JWT's signature and expiry):
//   /admin, /api/admin  -> valid JWT with isAdmin: true
//   /account            -> any valid JWT
//   /checkout, /api/orders -> any valid JWT: shoppers log in or sign up before ordering (browsing and the cart stay open)
//   /login, /signup     -> signed-in users skip straight to where they were going
// Pages and route handlers check again (and re-read is_admin from the database), so a matcher change can
// never open them up on its own.
const noStore = { "Cache-Control": "no-store" };

export async function proxy(req: NextRequest) {
  const { pathname, search, searchParams } = req.nextUrl;
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const api = pathname.startsWith("/api/");

  if (pathname.startsWith("/login") || pathname.startsWith("/signup")) {
    if (!claims || searchParams.has("expired")) return NextResponse.next();
    return NextResponse.redirect(new URL(safeNext(searchParams.get("next"), claims.isAdmin ? "/admin/" : "/account/"), req.url));
  }
  if (!claims) {
    if (api) return NextResponse.json({ error: "Please log in" }, { status: 401, headers: noStore });
    const login = new URL("/login/", req.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  if ((pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && !claims.isAdmin) {
    if (api) return NextResponse.json({ error: "Admins only" }, { status: 403, headers: noStore });
    return NextResponse.redirect(new URL("/account/?denied=1", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/account/:path*", "/checkout/:path*", "/api/orders/:path*", "/login/:path*", "/signup/:path*"],
};
