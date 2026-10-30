// Accounts, JWT sessions, the proxy and admin authorisation.
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as adminOrders } from "@/app/api/admin/orders/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { settings } from "@/lib/server/config";
import { hashPassword, verifyPassword } from "@/lib/server/passwords";
import { safeNext, signSession, verifySession } from "@/lib/server/session";
import { LocalStore, makeStore } from "@/lib/server/store";
import { proxy } from "@/proxy";
import { call, SECRET, sessionFrom, useTestEnv } from "./helpers";

const enc = (s: string) => new TextEncoder().encode(s);
const user = { id: "6f1c0d6e-1234-4d2b-9c1a-0123456789ab", email: "a@b.co", name: "Asha", is_admin: false, token_version: 0 };

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const [a, b] = [await hashPassword("correct horse"), await hashPassword("correct horse")];
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse", a)).toBe(true);
    expect(await verifyPassword("correct hors", a)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
  });
});

describe("JWT sessions", () => {
  useTestEnv();

  it("round-trips userId and isAdmin", async () => {
    const claims = await verifySession(await signSession({ ...user, is_admin: true }));
    expect(claims).toMatchObject({ sub: user.id, isAdmin: true, email: user.email, tv: 0 });
  });

  it("rejects tampered, expired, foreign and unsigned tokens", async () => {
    const good = await signSession(user);
    const [h, p, s] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), isAdmin: true })).toString("base64url");
    expect(await verifySession(`${h}.${forged}.${s}`)).toBeNull(); // flipping isAdmin breaks the signature
    const expired = await new SignJWT({ isAdmin: false, email: "x@y.z", name: "", tv: 0 }).setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id).setIssuer("kissaprints").setAudience("kissaprints-web").setIssuedAt(1).setExpirationTime(2).sign(enc(SECRET));
    expect(await verifySession(expired)).toBeNull();
    const otherKey = await new SignJWT({ isAdmin: true, email: "x@y.z", name: "", tv: 0 }).setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id).setIssuer("kissaprints").setAudience("kissaprints-web").setExpirationTime("1h").sign(enc("some-other-secret-0123456789abcdefghij"));
    expect(await verifySession(otherKey)).toBeNull();
    const wrongAudience = await new SignJWT({ isAdmin: true, email: "x@y.z", name: "", tv: 0 }).setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id).setIssuer("kissaprints").setAudience("someone-else").setExpirationTime("1h").sign(enc(SECRET));
    expect(await verifySession(wrongAudience)).toBeNull();
    const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${p}.`;
    expect(await verifySession(unsigned)).toBeNull();
    expect(await verifySession("")).toBeNull();
  });

  it("only allows same-site ?next= targets", () => {
    expect(safeNext("/admin/", "/account/")).toBe("/admin/");
    for (const bad of ["https://evil.example/", "//evil.example/", "/\\evil.example", "", null]) expect(safeNext(bad, "/account/")).toBe("/account/");
  });
});

describe("proxy (route protection)", () => {
  useTestEnv();
  const req = (path: string, token?: string) => new NextRequest(`http://localhost${path}`, { headers: token ? { cookie: `kp_session=${token}` } : {} });

  it("sends visitors to log in, customers away from /admin, and lets admins through", async () => {
    let res = await proxy(req("/admin/?tab=new"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).search).toBe("?next=%2Fadmin%2F%3Ftab%3Dnew");
    expect((await proxy(req("/api/admin/orders/"))).status).toBe(401);

    res = await proxy(req("/checkout/"));
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/login/?next=%2Fcheckout%2F");
    expect((await proxy(req("/api/orders/"))).status).toBe(401);

    const customer = await signSession(user);
    res = await proxy(req("/admin/", customer));
    expect(res.headers.get("location")).toBe("http://localhost/account/?denied=1");
    expect((await proxy(req("/api/admin/orders/", customer))).status).toBe(403);
    expect((await proxy(req("/account/", customer))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/checkout/", customer))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/api/orders/", customer))).headers.get("x-middleware-next")).toBe("1");

    const admin = await signSession({ ...user, is_admin: true });
    expect((await proxy(req("/admin/", admin))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/api/admin/orders/", admin))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/login/?next=/admin/", admin))).headers.get("location")).toBe("http://localhost/admin/");
    expect((await proxy(req("/admin/", admin + "x"))).status).toBe(307); // broken signature = signed out
  });
});

describe("accounts and admin authorisation", () => {
  const dir = useTestEnv();
  const store = () => makeStore(settings()) as LocalStore;

  it("signs up, logs in with a JWT cookie, and logs out everywhere", async () => {
    const created = await call(signup, "POST", "/api/auth/signup/", { body: { name: "Asha Rao", email: "Asha@Example.com", password: "s3cret-pass" } });
    expect(created.status).toBe(201);
    expect(created.data.user).toMatchObject({ email: "asha@example.com", isAdmin: false });
    const setCookie = created.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/kp_session=.+; Path=\/; .*HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    const claims = await verifySession(sessionFrom(created.headers).split("=")[1]);
    expect(claims).toMatchObject({ isAdmin: false, email: "asha@example.com" });
    expect(claims!.sub).toBe(created.data.user.id);
    await expect(store().getUserByEmail("asha@example.com")).resolves.toMatchObject({ is_admin: false });

    expect((await call(signup, "POST", "/api/auth/signup/", { body: { name: "Asha", email: "asha@example.com", password: "another-pass" } })).status).toBe(409);
    expect((await call(signup, "POST", "/api/auth/signup/", { body: { name: "Asha", email: "x@example.com", password: "short" } })).data.field).toBe("password");

    const bad = await call(login, "POST", "/api/auth/login/", { body: { email: "asha@example.com", password: "nope-nope" } });
    const unknown = await call(login, "POST", "/api/auth/login/", { body: { email: "nobody@example.com", password: "nope-nope" } });
    expect([bad.status, unknown.status]).toEqual([401, 401]);
    expect(bad.data.error).toBe(unknown.data.error); // no hint whether the email exists

    const ok = await call(login, "POST", "/api/auth/login/", { body: { email: "ASHA@example.com", password: "s3cret-pass" } });
    const cookie = sessionFrom(ok.headers);
    expect((await call(me, "GET", "/api/auth/me/", { cookie })).data.user.email).toBe("asha@example.com");
    expect((await call(adminOrders, "GET", "/api/admin/orders/", { cookie })).status).toBe(403); // customers aren't admins

    const out = await call(logout, "POST", "/api/auth/logout/", { body: { everywhere: true }, cookie });
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect((await call(me, "GET", "/api/auth/me/", { cookie })).data.user).toBeNull(); // token_version moved on
  });

  it("re-checks is_admin in the database on every admin request", async () => {
    const admin = await store().createUser({ email: "boss@example.com", name: "Boss", password_hash: await hashPassword("boss-pass-1"), is_admin: true });
    const res = await call(login, "POST", "/api/auth/login/", { body: { email: "boss@example.com", password: "boss-pass-1" } });
    expect(res.data.user.isAdmin).toBe(true);
    const cookie = sessionFrom(res.headers);
    expect((await call(adminOrders, "GET", "/api/admin/orders/", { cookie })).status).toBe(200);
    await store().updateUser(admin.id, { is_admin: false }); // demoted: the old JWT still says isAdmin...
    expect((await call(adminOrders, "GET", "/api/admin/orders/", { cookie })).status).toBe(403); // ...but the database wins
    await store().updateUser(admin.id, { is_admin: true, token_version: 5 }); // revoked sessions
    expect((await call(adminOrders, "GET", "/api/admin/orders/", { cookie })).status).toBe(401);
    expect(dir()).toBeTruthy();
  });

  it("is switched off on Vercel until JWT_SECRET is set", async () => {
    delete process.env.JWT_SECRET;
    process.env.VERCEL = "1";
    expect(settings().problems.join(" ")).toContain("JWT_SECRET");
    expect((await call(login, "POST", "/api/auth/login/", { body: { email: "a@b.co", password: "whatever1" } })).status).toBe(503);
    expect(await verifySession(await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).sign(enc(SECRET)))).toBeNull();
  });
});
