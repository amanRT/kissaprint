// Pricing, validation, payments, the order flow, webhooks, uploads, test orders and the Supabase requests.
import { createHmac } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as adminChanges } from "@/app/api/admin/changes/route";
import { POST as adminDelete } from "@/app/api/admin/delete/route";
import { GET as adminOrder, POST as adminUpdate } from "@/app/api/admin/order/route";
import { GET as adminOrders } from "@/app/api/admin/orders/route";
import { GET as adminProducts, POST as setProduct } from "@/app/api/admin/products/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as orderView } from "@/app/api/order/route";
import { POST as createOrder } from "@/app/api/orders/route";
import { POST as quoteRoute } from "@/app/api/quote/route";
import { POST as webhook } from "@/app/api/razorpay-webhook/route";
import { POST as track } from "@/app/api/track/route";
import { PUT as uploadLocal } from "@/app/api/upload-local/route";
import { POST as uploads } from "@/app/api/uploads/route";
import { POST as verify } from "@/app/api/verify/route";
import { occasions, site } from "@/lib/catalog";
import { collectionListing, shopListing } from "@/lib/collections";
import { visibilityFrom } from "@/lib/visible";
import { settings } from "@/lib/server/config";
import { cleanAddress, cleanContact, FieldError, isTest, newOrderId, normalisePhone, ORDER_ID } from "@/lib/server/orders";
import { hashPassword } from "@/lib/server/passwords";
import { Razorpay } from "@/lib/server/payments";
import { CartError, PHOTO_KEY, priceLine, quote, shippingFor } from "@/lib/server/pricing";
import { LocalStore, makeStore, SupabaseStore } from "@/lib/server/store";
import { signSession } from "@/lib/server/session";
import { ADDRESS, call, CUSTOMER, PHOTO, sessionFrom, shopperCookie, useTestEnv } from "./helpers";

// Route handlers expire Next's cache when products are switched on/off; outside a Next server that's a no-op spy.
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const hmac = (secret: string, msg: string | Buffer) => createHmac("sha256", secret).update(msg).digest("hex");

describe("pricing", () => {
  it("defaults to the option matching the headline price", () => {
    const line = priceLine({ slug: "classic-memoroids", qty: 1 });
    expect([line.unit_price, line.photos_needed]).toEqual([249, 10]);
    expect(line.options).toEqual([["Pack size", "10 prints"], ["Finish", "Matte"]]);
    expect(priceLine({ slug: "custom-newspaper" }).unit_price).toBe(549); // not the first value (449)
  });
  it("prices options and quantity, ignoring prices sent by the browser", () => {
    const line = priceLine({ slug: "classic-memoroids", qty: 2, opts: { "Pack size": "30 prints", Finish: "Glossy" } });
    expect([line.unit_price, line.line_total, line.photos_needed]).toEqual([599, 1198, 30]);
    expect(priceLine({ slug: "song-plaque", price: 1, unit_price: 1 }).unit_price).toBe(549);
  });
  it("refuses carts it can't price", () => {
    for (const bad of [{ slug: "nope" }, { slug: "song-plaque", qty: 0 }, { slug: "song-plaque", qty: 21 }, { slug: "song-plaque", qty: "x" },
      { slug: "song-plaque", opts: { Size: "Huge" } }, { slug: "song-plaque", photos: [{ key: "../../etc/passwd" }] }, "text"]) {
      expect(() => priceLine(bad), JSON.stringify(bad)).toThrow(CartError);
    }
    expect(() => quote([])).toThrow(CartError);
  });
  it("adds shipping below the free-shipping threshold", () => {
    expect(shippingFor(site.free_shipping_over - 1)).toBe(site.shipping_fee);
    expect(shippingFor(site.free_shipping_over)).toBe(0);
    const q = quote([{ slug: "boarding-pass-card", qty: 1 }]);
    expect(q.total).toBe(q.subtotal + site.shipping_fee);
  });
});

describe("validation", () => {
  it("normalises Indian mobile numbers", () => {
    for (const raw of ["9876543210", "+91 98765 43210", "09876543210", "919876543210", "98765-43210"]) expect(normalisePhone(raw)).toBe("9876543210");
    for (const raw of ["12345", "5876543210", "", null, "98765432101"]) expect(normalisePhone(raw)).toBe("");
  });
  it("cleans contact details and addresses, naming the bad field", () => {
    expect(cleanContact(CUSTOMER)).toEqual({ name: "Aman Test", phone: "9876543210", email: "aman@example.com" });
    expect(cleanAddress(ADDRESS).pincode).toBe("411001");
    for (const [field, value] of [["email", "nope"], ["phone", "123"], ["name", ""]]) {
      expect(() => cleanContact({ ...CUSTOMER, [field]: value })).toThrow(expect.objectContaining({ field }));
    }
    for (const [field, value] of [["pincode", "011001"], ["state", "Atlantis"], ["city", ""]]) {
      expect(() => cleanAddress({ ...ADDRESS, [field]: value })).toThrow(FieldError);
    }
  });
  it("makes readable, unique order IDs", () => {
    const ids = new Set(Array.from({ length: 200 }, newOrderId));
    expect([...ids].every((id) => ORDER_ID.test(id))).toBe(true);
    expect(ids.size).toBeGreaterThan(195);
  });
});

describe("Razorpay signatures", () => {
  it("checks payment and webhook signatures", () => {
    const rp = new Razorpay("rzp_test_x", "secret123", "whsec");
    expect(rp.verifyPayment("order_ABC", "pay_XYZ", hmac("secret123", "order_ABC|pay_XYZ"))).toBe(true);
    expect(rp.verifyPayment("order_ABC", "pay_OTHER", hmac("secret123", "order_ABC|pay_XYZ"))).toBe(false);
    expect(rp.verifyPayment("order_ABC", "pay_XYZ", null)).toBe(false);
    const body = Buffer.from('{"event":"order.paid"}');
    expect(rp.verifyWebhook(body, hmac("whsec", body))).toBe(true);
    expect(rp.verifyWebhook(Buffer.concat([body, Buffer.from(" ")]), hmac("whsec", body))).toBe(false);
    expect(new Razorpay("k", "s", "").verifyWebhook(body, "")).toBe(false);
  });
});

async function adminCookie() {
  const store = makeStore(settings())!;
  await store.createUser({ email: "boss@example.com", name: "Boss", password_hash: await hashPassword("boss-pass-1"), is_admin: true });
  return sessionFrom((await call(login, "POST", "/api/auth/login/", { body: { email: "boss@example.com", password: "boss-pass-1" } })).headers);
}

describe("order flow", () => {
  useTestEnv();
  const place = async (items: unknown[] = [{ slug: "classic-memoroids", qty: 2, opts: { "Pack size": "30 prints" }, note: "us, always", photos: [PHOTO] }], customer = CUSTOMER) => {
    const res = await call(createOrder, "POST", "/api/orders/", { cookie: await shopperCookie(), body: { items, customer, address: ADDRESS } });
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    return res.data;
  };

  it("quotes on the server", async () => {
    const res = await call(quoteRoute, "POST", "/api/quote/", { body: { items: [{ slug: "song-plaque", qty: 1 }] } });
    expect([res.data.subtotal, res.data.shipping, res.data.payments]).toEqual([549, 79, "mock"]);
    expect((await call(quoteRoute, "POST", "/api/quote/", { body: { items: [] } })).status).toBe(400);
  });

  it("checks out, pays, and gets fulfilled through the admin", async () => {
    const placed = await place();
    const { id, token } = placed.order;
    expect(placed.order.total).toBe(1198); // 2 x 599, free shipping
    expect(placed.payment.amount).toBe(119800);
    expect(placed.payment.prefill.contact).toBe("+919876543210");

    expect((await call(verify, "POST", "/api/verify/", { body: { ...placed.payment.mock, razorpay_signature: "0".repeat(64), id } })).status).toBe(400);
    for (let i = 0; i < 2; i++) expect((await call(verify, "POST", "/api/verify/", { body: { ...placed.payment.mock, id } })).data.status).toBe("paid");

    expect((await call(orderView, "GET", `/api/order/?id=${id}&t=wrong`)).status).toBe(404);
    const view = await call(orderView, "GET", `/api/order/?id=${id}&t=${token}`);
    expect([view.data.status_label, view.data.items[0].photos]).toEqual(["Order confirmed", 1]);
    expect(JSON.stringify(view.data)).not.toContain("token");
    expect((await call(track, "POST", "/api/track/", { body: { id, contact: "9999999999" } })).status).toBe(404);
    expect((await call(track, "POST", "/api/track/", { body: { id: id.toLowerCase(), contact: "98765 43210" } })).data.token).toBe(token);

    const cookie = await adminCookie();
    const listing = await call(adminOrders, "GET", "/api/admin/orders/?tab=new", { cookie });
    expect(listing.data.orders.map((o: { id: string }) => o.id)).toEqual([id]);
    expect([listing.data.counts.new, listing.data.orders[0].photos_needed, listing.data.orders[0].test]).toEqual([1, 30, true]);
    expect(Object.keys((await call(adminOrder, "GET", `/api/admin/order/?id=${id}`, { cookie })).data.photos)).toContain(PHOTO.key);
    const update = { id, status: "shipped", note: "Packed with love", tracking: { courier: "Delhivery", number: "1234", url: "https://www.delhivery.com/track/package/1234" } };
    expect((await call(adminUpdate, "POST", "/api/admin/order/", { body: update, cookie })).data.order.status).toBe("shipped");
    expect((await call(adminUpdate, "POST", "/api/admin/order/", { body: { ...update, status: "pending" }, cookie })).status).toBe(400);
    expect((await call(adminUpdate, "POST", "/api/admin/order/", { body: { ...update, tracking: { url: "javascript:alert(1)" } }, cookie })).status).toBe(400);
    const after = (await call(orderView, "GET", `/api/order/?id=${id}&t=${token}`)).data;
    expect(after.tracking.courier).toBe("Delhivery");
    expect(after.history.map((h: { status: string }) => h.status)).toEqual(["pending", "paid", "shipped"]);
  });

  it("keeps unpaid orders apart, flags test orders and only deletes those", async () => {
    const { id } = (await place()).order;
    const cookie = await adminCookie();
    expect((await call(adminOrders, "GET", "/api/admin/orders/?tab=new", { cookie })).data.orders).toEqual([]);
    expect((await call(adminOrders, "GET", "/api/admin/orders/?tab=unpaid", { cookie })).data.orders[0].id).toBe(id);
    expect((await call(adminOrders, "GET", "/api/admin/orders/?tab=all&q=aman", { cookie })).data.counts.all).toBe(1);
    const store = makeStore(settings())!;
    await store.updateOrder(id, { gateway: "razorpay" }); // pretend it was a live payment
    expect((await call(adminDelete, "POST", "/api/admin/delete/", { body: { id }, cookie })).status).toBe(400);
    await store.updateOrder(id, { gateway: "mock" });
    expect((await call(adminDelete, "POST", "/api/admin/delete/", { body: { id }, cookie })).status).toBe(200);
    expect(await store.getOrder(id)).toBeNull();
  });

  it("tells the dashboard when anything changed", async () => {
    const cookie = await adminCookie();
    expect((await call(adminChanges, "GET", "/api/admin/changes/")).status).toBe(401);
    const before = (await call(adminChanges, "GET", "/api/admin/changes/", { cookie })).data.latest;
    await place();
    const after = (await call(adminChanges, "GET", "/api/admin/changes/", { cookie })).data.latest;
    expect(after).not.toBe(before);
    expect((await call(adminOrders, "GET", "/api/admin/orders/?tab=all", { cookie })).data.latest).toBe(after);
  });

  it("needs an account to order, and links the order to it", async () => {
    const guest = await call(createOrder, "POST", "/api/orders/", { body: { items: [{ slug: "song-plaque" }], customer: CUSTOMER, address: ADDRESS } });
    expect([guest.status, guest.data.error]).toEqual([401, "Please log in"]);
    const cookie = await shopperCookie();
    const res = await call(createOrder, "POST", "/api/orders/", { cookie, body: { items: [{ slug: "song-plaque" }], customer: CUSTOMER, address: ADDRESS } });
    const order = (await makeStore(settings())!.getOrder(res.data.order.id))!;
    const { GET: me } = await import("@/app/api/auth/me/route");
    expect(order.user_id).toBe((await call(me, "GET", "/api/auth/me/", { cookie })).data.user.id);
  });

  it("names the field to fix", async () => {
    const res = await call(createOrder, "POST", "/api/orders/", { cookie: await shopperCookie(), body: { items: [{ slug: "song-plaque" }], customer: { ...CUSTOMER, phone: "12" }, address: ADDRESS } });
    expect([res.status, res.data.field]).toEqual([400, "phone"]);
  });

  it("issues signed local upload links and refuses non-photos", async () => {
    const res = await call(uploads, "POST", "/api/uploads/", { body: { slug: "classic-memoroids", files: [{ name: "a.jpg", type: "image/jpeg", size: 10 }] } });
    const target = res.data.uploads[0];
    expect(PHOTO_KEY.test(target.key)).toBe(true);
    const qs = target.url.split("?")[1];
    expect((await call(uploadLocal, "PUT", `/api/upload-local/?${qs.replace("sig=", "sig=0")}`, { raw: "x" })).status).toBe(403);
    expect((await call(uploadLocal, "PUT", `/api/upload-local/?${qs}`, { raw: "jpegbytes" })).status).toBe(200);
    expect((await call(uploads, "POST", "/api/uploads/", { body: { slug: "classic-memoroids", files: [{ name: "a.exe", type: "application/x-msdownload" }] } })).status).toBe(400);
    expect((await call(uploads, "POST", "/api/uploads/", { body: { slug: "classic-memoroids", files: [{ name: "big.jpg", type: "image/jpeg", size: 30 * 2 ** 20 }] } })).status).toBe(400);
  });

  it("only accepts JSON", async () => {
    expect((await call(login, "POST", "/api/auth/login/", { raw: "email=x", headers: { "content-type": "application/x-www-form-urlencoded" } })).status).toBe(415);
  });
});

describe("product visibility (/admin/products/)", () => {
  useTestEnv();
  const order = (cookie: string) => call(createOrder, "POST", "/api/orders/", { cookie, body: { items: [{ slug: "song-plaque" }], customer: CUSTOMER, address: ADDRESS } });

  it("lets admins switch a product off - it can't be priced, uploaded for or ordered - and back on", async () => {
    const shopper = await shopperCookie();
    expect((await call(adminProducts, "GET", "/api/admin/products/", { cookie: shopper })).status).toBe(403);
    expect((await call(setProduct, "POST", "/api/admin/products/", { cookie: shopper, body: { slug: "song-plaque", hidden: true } })).status).toBe(403);

    const cookie = await adminCookie();
    const list = (await call(adminProducts, "GET", "/api/admin/products/", { cookie })).data.products;
    expect(list).toHaveLength(14);
    expect(list.every((p: { hidden: boolean }) => !p.hidden)).toBe(true);

    const off = await call(setProduct, "POST", "/api/admin/products/", { cookie, body: { slug: "song-plaque", hidden: true } });
    expect(off.data.product).toMatchObject({ slug: "song-plaque", hidden: true, updated_by: "Boss" });
    expect(revalidateTag).toHaveBeenCalledWith("products", { expire: 0 }); // pages re-render on their next visit
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");

    const q = await call(quoteRoute, "POST", "/api/quote/", { body: { items: [{ slug: "song-plaque" }, { slug: "star-map" }] } });
    expect([q.status, q.data.error]).toEqual([400, "Song Glass Plaque is currently unavailable - please remove it from your cart"]);
    expect((await order(shopper)).status).toBe(400);
    expect((await call(uploads, "POST", "/api/uploads/", { body: { slug: "song-plaque", files: [{ name: "a.jpg", type: "image/jpeg", size: 10 }] } })).status).toBe(400);
    expect((await call(quoteRoute, "POST", "/api/quote/", { body: { items: [{ slug: "star-map" }] } })).status).toBe(200); // others unaffected

    await call(setProduct, "POST", "/api/admin/products/", { cookie, body: { slug: "song-plaque", hidden: false } });
    expect((await order(shopper)).status).toBe(201);
    const again = (await call(adminProducts, "GET", "/api/admin/products/", { cookie })).data.products;
    expect(again.find((p: { slug: string }) => p.slug === "song-plaque")).toMatchObject({ hidden: false, updated_by: "Boss" });
  });

  it("rejects bad requests", async () => {
    const cookie = await adminCookie();
    expect((await call(setProduct, "POST", "/api/admin/products/", { cookie, body: { slug: "nope", hidden: true } })).status).toBe(400);
    expect((await call(setProduct, "POST", "/api/admin/products/", { cookie, body: { slug: "song-plaque", hidden: "yes" } })).status).toBe(400);
    expect((await call(setProduct, "POST", "/api/admin/products/", { body: { slug: "song-plaque", hidden: true } })).status).toBe(401);
  });
});

describe("what the shop shows when products are switched off", () => {
  it("drops a category once its last product is hidden, everywhere it's linked", () => {
    const vis = visibilityFrom(new Set(["photo-metal-keychain"])); // the only keychain
    expect(vis.url("/collections/keychains/")).toBe(false);
    expect(vis.url("/products/photo-metal-keychain/")).toBe(false);
    expect(vis.url("/collections/memoroids/")).toBe(true);
    expect(vis.url("/bulk-orders/")).toBe(true); // not a catalog page
    const shop = shopListing(vis);
    expect(shop.items.map((p) => p.slug)).not.toContain("photo-metal-keychain");
    expect(shop.chips.map(([, url]) => url)).not.toContain("/collections/keychains/");
    expect(shop.related.map((c) => c.slug)).not.toContain("keychains");
    const empty = collectionListing("keychains", vis)!;
    expect(empty.items).toEqual([]); // still reachable (old links), shows "taking a short break", and is noindex
    expect(collectionListing("memoroids", vis)!.items.length).toBeGreaterThan(0);
  });

  it("keeps an occasion while any of its products is on", () => {
    const couples = occasions.find((o) => o.slug === "for-couples")!.products.map((p) => p.slug);
    expect(visibilityFrom(new Set(couples.slice(1))).url("/gifts/for-couples/")).toBe(true); // one left
    const none = visibilityFrom(new Set(couples));
    expect(none.url("/gifts/for-couples/")).toBe(false);
    expect(none.groups(occasions).map((o) => o.slug)).not.toContain("for-couples");
  });
});

describe("team test accounts", () => {
  useTestEnv({ TEST_PHONES: "9000000001" }); // the old phone-number setting must no longer skip payment

  it("skip payment for their own orders only, always flagged as tests", async () => {
    const store = makeStore(settings())!;
    await store.createUser({ email: "founder@example.com", name: "Founder", password_hash: await hashPassword("founder-pass-1"), is_admin: true, is_tester: true });
    const founder = sessionFrom((await call(login, "POST", "/api/auth/login/", { body: { email: "founder@example.com", password: "founder-pass-1" } })).headers);
    const body = { items: [{ slug: "song-plaque" }], customer: CUSTOMER, address: ADDRESS };
    expect((await call(quoteRoute, "POST", "/api/quote/", { body, cookie: founder })).data.test_account).toBe(true);
    const res = await call(createOrder, "POST", "/api/orders/", { cookie: founder, body });
    expect([res.status, res.data.payment]).toEqual([201, { gateway: "bypass" }]);
    const order = (await store.getOrder(res.data.order.id))!;
    expect([order.status, order.gateway, isTest(order)]).toEqual(["paid", "bypass", true]);

    const shopper = await shopperCookie();
    expect((await call(quoteRoute, "POST", "/api/quote/", { body, cookie: shopper })).data.test_account).toBe(false);
    const other = await call(createOrder, "POST", "/api/orders/", { cookie: shopper, body: { ...body, customer: { ...CUSTOMER, phone: "9000000001" } } });
    expect(other.data.payment.gateway).toBe("mock"); // everyone else pays - even typing a team phone number
  });
});

describe("Razorpay webhook", () => {
  useTestEnv({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "keysecret", RAZORPAY_WEBHOOK_SECRET: "whsec" });

  it("marks the order paid once, ignoring bad signatures and wrong amounts", async () => {
    vi.spyOn(Razorpay.prototype, "createOrder").mockResolvedValue({ id: "order_RZP1", amount: 62800 });
    const placed = await call(createOrder, "POST", "/api/orders/", { cookie: await shopperCookie(), body: { items: [{ slug: "song-plaque" }], customer: CUSTOMER, address: ADDRESS } });
    expect(placed.status).toBe(201);
    expect(placed.data.payment.mock).toBeUndefined();
    const id = placed.data.order.id;
    const store = makeStore(settings())!;
    expect((await store.getOrder(id))!.gateway).toBe("razorpay_test");

    const send = (event: string, amount = 62800) => {
      const body = JSON.stringify({ event, payload: { payment: { entity: { id: "pay_RZP1", order_id: "order_RZP1", amount, currency: "INR", method: "upi", error_description: "Bank declined" } } } });
      return call(webhook, "POST", "/api/razorpay-webhook/", { raw: body, headers: { "x-razorpay-signature": hmac("whsec", body), "content-type": "application/json" } });
    };
    expect((await call(webhook, "POST", "/api/razorpay-webhook/", { raw: "{}", headers: { "x-razorpay-signature": "bad" } })).status).toBe(400);
    await send("payment.failed");
    await send("order.paid", 100);
    expect((await store.getOrder(id))!.status).toBe("pending");
    expect((await send("payment.captured")).status).toBe(200);
    expect((await send("order.paid")).status).toBe(200); // duplicate delivery is harmless
    const order = (await store.getOrder(id))!;
    expect([order.status, order.razorpay_payment_id]).toEqual(["paid", "pay_RZP1"]);
    expect(order.history.filter((h) => h.status === "paid")).toHaveLength(1);
  });
});

describe("Supabase requests", () => {
  afterEach(() => vi.unstubAllGlobals());
  const record = (replies: [number, unknown][]) => {
    const calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const [status, data] = replies.shift() ?? [200, []];
      return new Response(JSON.stringify(data), { status });
    }));
    return calls;
  };
  const store = new SupabaseStore("https://abc.supabase.co", "sb_secret_xyz", "order-photos");

  it("talks to the REST API with the secret key", async () => {
    const calls = record([[201, [{ id: "KP-ABCDEF" }]], [200, [{ id: "KP-ABCDEF", status: "paid" }]], [200, []]]);
    await store.createOrder({ id: "KP-ABCDEF" } as never);
    expect([calls[0].method, calls[0].url]).toEqual(["POST", "https://abc.supabase.co/rest/v1/orders"]);
    expect(calls[0].headers.apikey).toBe("sb_secret_xyz");
    expect(calls[0].headers.Authorization).toBeUndefined(); // new-style secret keys go in apikey only
    expect((await store.updateOrder("KP-ABCDEF", { status: "paid" }, ["pending"]))!.status).toBe("paid");
    expect(calls[1].url).toBe("https://abc.supabase.co/rest/v1/orders?id=eq.KP-ABCDEF&status=in.(pending)");
    await store.listOrders({ statuses: ["paid"], q: "riya, (x)", oldestFirst: true, userId: "6f1c0d6e-1234-4d2b-9c1a-0123456789ab" });
    expect(calls[2].url).toContain("order=created_at.asc");
    expect(calls[2].url).toContain("user_id=eq.6f1c0d6e-1234-4d2b-9c1a-0123456789ab");
    expect(calls[2].url).toContain("or=(id.ilike.*riya%20x*%2Ccustomer-%3E%3Ename.ilike"); // commas/brackets stripped from q
  });

  it("creates users and signs photo links", async () => {
    const key = `up/20261029/${"b".repeat(32)}.jpg`;
    const calls = record([[409, { message: "duplicate key" }], [200, { url: `/object/upload/sign/order-photos/${key}?token=T1` }],
      [200, [{ path: key, signedURL: `/object/sign/order-photos/${key}?token=T2` }]]]);
    await expect(store.createUser({ email: "a@b.co", name: "A", password_hash: "x" })).rejects.toThrow("a@b.co");
    expect(calls[0].body).toEqual({ email: "a@b.co", name: "A", password_hash: "x", is_admin: false });
    const [target] = await store.uploadTargets([[key, "image/jpeg"]]);
    expect(target.url).toBe(`https://abc.supabase.co/storage/v1/object/upload/sign/order-photos/${key}?token=T1`);
    expect((await store.photoUrls([key]))[key]).toBe(`https://abc.supabase.co/storage/v1/object/sign/order-photos/${key}?token=T2`);
    expect(calls[2].body).toEqual({ expiresIn: 3600, paths: [key] });
  });

  it("upserts product settings by slug", async () => {
    const calls = record([[201, [{ slug: "song-plaque", hidden: true, updated_at: "t", updated_by: "Boss" }]], [200, []]]);
    expect((await store.setProductHidden("song-plaque", true, "Boss")).hidden).toBe(true);
    expect([calls[0].method, calls[0].url]).toEqual(["POST", "https://abc.supabase.co/rest/v1/product_settings?on_conflict=slug"]);
    expect(calls[0].headers.Prefer).toBe("resolution=merge-duplicates,return=representation");
    expect(calls[0].body).toMatchObject({ slug: "song-plaque", hidden: true, updated_by: "Boss" });
    expect(await store.productSettings()).toEqual([]);
  });

  it("sends legacy service_role keys as a bearer token too", async () => {
    const calls = record([[200, []]]);
    await new SupabaseStore("https://abc.supabase.co", "eyJhbGciOi.legacy", "order-photos").getOrder("KP-ABCDEF");
    expect(calls[0].headers.Authorization).toBe("Bearer eyJhbGciOi.legacy");
    expect(await store.getOrder("../etc")).toBeNull(); // never even sent
  });
});

describe("settings", () => {
  useTestEnv();
  it("flags setup mistakes and refuses to fake anything on Vercel", async () => {
    Object.assign(process.env, { VERCEL: "1", SUPABASE_URL: "https://x.supabase.co/rest/v1/", SUPABASE_SECRET_KEY: "sb_publishable_abc", RAZORPAY_KEY_ID: "rzp_test_k", RAZORPAY_KEY_SECRET: "s" });
    const cfg = settings();
    expect([cfg.storage, cfg.supabaseUrl]).toEqual(["", "https://x.supabase.co"]);
    expect(cfg.problems.join(" ")).toContain("publishable key");
    expect(cfg.problems.join(" ")).toContain("RAZORPAY_WEBHOOK_SECRET");
    delete process.env.RAZORPAY_KEY_ID;
    expect(settings().payments).toBe("");
    const cookie = `kp_session=${await signSession({ id: "6f1c0d6e-1234-4d2b-9c1a-0123456789ab", email: "a@b.co", name: "A", is_admin: false, token_version: 0 })}`;
    expect((await call(createOrder, "POST", "/api/orders/", { cookie, body: { items: [{ slug: "song-plaque" }], customer: CUSTOMER, address: ADDRESS } })).status).toBe(503);
    expect(new LocalStore(process.env.KP_DATA_DIR!).kind).toBe("local");
  });
});
