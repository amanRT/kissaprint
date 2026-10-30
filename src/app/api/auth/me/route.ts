import { handle, json, publicUser } from "@/lib/server/http";

/** The signed-in user, or {user: null}. Always 200 so a signed-out visit logs no console error. */
export const GET = handle(async (ctx) => {
  const claims = await ctx.session();
  if (!claims || !ctx.cfg.storage) return json({ user: null });
  const user = await ctx.store.getUserById(claims.sub);
  return json({ user: user && user.token_version === claims.tv ? publicUser(user) : null });
});
