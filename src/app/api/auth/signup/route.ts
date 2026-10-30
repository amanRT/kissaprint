import { cleanEmail, cleanName, cleanPassword, requireAuthConfigured, withSession } from "@/lib/server/accounts";
import { ApiError, handle } from "@/lib/server/http";
import { hashPassword } from "@/lib/server/passwords";
import { Conflict } from "@/lib/server/store";

/** New customer account (never an admin - admins are promoted in the database or with `npm run create-admin`). */
export const POST = handle(async (ctx) => {
  requireAuthConfigured(ctx);
  const data = await ctx.body();
  const name = cleanName(data.name);
  const email = cleanEmail(data.email);
  const password = cleanPassword(data.password);
  try {
    const user = await ctx.store.createUser({ email, name, password_hash: await hashPassword(password), is_admin: false });
    return await withSession(ctx, user, 201);
  } catch (err) {
    if (err instanceof Conflict) throw new ApiError(409, "An account with this email already exists - log in instead", "email");
    throw err;
  }
});
