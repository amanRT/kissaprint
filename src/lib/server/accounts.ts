// Sign-up / log-in helpers shared by the auth routes and the create-admin script.
import { ApiError, json, publicUser, type Ctx } from "./http";
import { now } from "./orders";
import { PASSWORD_MIN } from "./passwords";
import { sessionCookie, signSession } from "./session";
import type { User } from "./store";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function cleanEmail(raw: unknown): string {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 120) throw new ApiError(400, "Please enter a valid email address", "email");
  return email;
}

export function cleanName(raw: unknown): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2) throw new ApiError(400, "Please enter your name", "name");
  if (name.length > 80) throw new ApiError(400, "Your name is too long (max 80 characters)", "name");
  return name;
}

export function cleanPassword(raw: unknown): string {
  const password = String(raw ?? "");
  if (password.length < PASSWORD_MIN) throw new ApiError(400, `Use at least ${PASSWORD_MIN} characters for your password`, "password");
  if (password.length > 200) throw new ApiError(400, "That password is too long", "password");
  return password;
}

export function requireAuthConfigured(ctx: Ctx) {
  if (!ctx.cfg.jwtSecret) throw new ApiError(503, "Accounts aren't switched on yet - the shop owner needs to set JWT_SECRET");
}

/** JSON reply that also signs the user in: a fresh JWT in the HttpOnly session cookie. */
export async function withSession(ctx: Ctx, user: User, status = 200) {
  const res = json({ user: publicUser(user) }, status);
  res.cookies.set(sessionCookie(await signSession(user), ctx.secure));
  await ctx.store.updateUser(user.id, { last_login_at: now() });
  return res;
}
