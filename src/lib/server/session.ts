// Signed session tokens (JWT, HS256) in an HttpOnly cookie. Used by proxy.ts, route handlers and server components.
// Claims: sub = user id, isAdmin, email, name, tv = the user's token_version (bumping it in the DB revokes every
// token issued before), plus iss/aud/iat/exp. Verifying needs only the secret - no database round trip.
import { jwtVerify, SignJWT } from "jose";
import { settings } from "./config";

export const SESSION_COOKIE = "kp_session";
export const SESSION_DAYS = 7;
const ISSUER = "kissaprints";
const AUDIENCE = "kissaprints-web";

export type SessionClaims = { sub: string; isAdmin: boolean; email: string; name: string; tv: number };
export type SessionUser = { id: string; email: string; name: string; is_admin: boolean; token_version: number };

const key = () => {
  const secret = settings().jwtSecret;
  return secret ? new TextEncoder().encode(secret) : null;
};

export async function signSession(user: SessionUser): Promise<string> {
  const k = key();
  if (!k) throw new Error("JWT_SECRET is not configured");
  return new SignJWT({ isAdmin: user.is_admin, email: user.email, name: user.name, tv: user.token_version })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`)
    .sign(k);
}

/** The token's claims if it is genuine and unexpired, else null. Never throws. */
export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  const k = key();
  if (!token || !k) return null;
  try {
    const { payload } = await jwtVerify(token, k, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    const { sub, isAdmin, email, name, tv } = payload as Record<string, unknown>;
    if (typeof sub !== "string" || typeof isAdmin !== "boolean" || typeof email !== "string" || typeof tv !== "number") return null;
    return { sub, isAdmin, email, name: typeof name === "string" ? name : "", tv };
  } catch {
    return null; // bad signature, expired, wrong issuer/audience, malformed
  }
}

export function sessionCookie(token: string, secure: boolean) {
  return { name: SESSION_COOKIE, value: token, httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: SESSION_DAYS * 24 * 3600 };
}
export const clearedCookie = (secure: boolean) => ({ ...sessionCookie("", secure), maxAge: 0 });

/** Same-site relative paths only, so ?next= can't send people to another site. */
export const safeNext = (next: string | null | undefined, fallback: string) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
