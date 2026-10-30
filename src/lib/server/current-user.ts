// For server components: the signed-in user, verified (JWT) and re-checked against the database.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { settings } from "./config";
import { SESSION_COOKIE, verifySession } from "./session";
import { makeStore, type User } from "./store";

export type Viewer = { state: "signed-out" } | { state: "expired" } | { state: "signed-in"; user: User };

export async function currentUser(): Promise<Viewer> {
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return { state: "signed-out" };
  const store = makeStore(settings());
  const user = store ? await store.getUserById(claims.sub) : null;
  // Deleted account or revoked token (token_version bumped): treat as signed out.
  if (!user || user.token_version !== claims.tv) return { state: "expired" };
  return { state: "signed-in", user };
}

/** For /admin/* pages: the admin, or a redirect (log in again / not for customers). proxy.ts checked the JWT first;
 *  this re-reads is_admin from the database on every request, so revoking admin rights takes effect immediately. */
export async function requireAdminPage(path: string): Promise<User> {
  const viewer = await currentUser();
  if (viewer.state === "expired") redirect(`/login/?expired=1&next=${encodeURIComponent(path)}`);
  if (viewer.state !== "signed-in") redirect(`/login/?next=${encodeURIComponent(path)}`);
  if (!viewer.user.is_admin) redirect("/account/?denied=1");
  return viewer.user;
}
