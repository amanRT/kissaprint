import { cleanEmail, requireAuthConfigured, withSession } from "@/lib/server/accounts";
import { ApiError, handle } from "@/lib/server/http";
import { dummyHash, verifyPassword } from "@/lib/server/passwords";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Email + password -> session cookie with a JWT carrying userId and isAdmin. */
export const POST = handle(async (ctx) => {
  requireAuthConfigured(ctx);
  const data = await ctx.body();
  const email = cleanEmail(data.email);
  const password = String(data.password ?? "");
  const user = await ctx.store.getUserByEmail(email);
  // Unknown emails still pay for a hash check: same timing and same message, so nobody can probe which emails exist.
  const ok = user ? await verifyPassword(password, user.password_hash) : (await verifyPassword(password, await dummyHash()), false);
  if (!user || !ok) {
    await pause(700); // slows down password guessing
    throw new ApiError(401, "That email and password don't match", "password");
  }
  return withSession(ctx, user);
});
