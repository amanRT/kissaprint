import { handle, json } from "@/lib/server/http";
import { clearedCookie } from "@/lib/server/session";

/** Clears the cookie. With {"everywhere": true} it also revokes every other session (token_version + 1). */
export const POST = handle(async (ctx) => {
  const data = await ctx.body().catch(() => ({}) as Record<string, unknown>);
  if (data.everywhere) {
    const user = await ctx.requireUser();
    await ctx.store.updateUser(user.id, { token_version: user.token_version + 1 });
  }
  const res = json({ ok: true });
  res.cookies.set(clearedCookie(ctx.secure));
  return res;
});
