import { ApiError, handle, json, type Ctx } from "@/lib/server/http";
import { cleanAddress, cleanContact, newOrder, withStatus, type Address, type Customer, type Order } from "@/lib/server/orders";
import type { RazorpayOrder } from "@/lib/server/payments";
import { quote, type Quote } from "@/lib/server/pricing";
import { Conflict } from "@/lib/server/store";
import { hiddenNow } from "@/lib/server/visibility";

async function save(ctx: Ctx, q: Quote, customer: Customer, address: Address, label: string, userId: string | null, prepare: (o: Order) => Promise<void> | void) {
  for (let attempt = 0; attempt < 3; attempt++) { // retry only on an order-ID collision (1 in ~900 million)
    const order = newOrder(q, customer, address, label, userId);
    await prepare(order);
    try {
      return await ctx.store.createOrder(order);
    } catch (err) {
      if (!(err instanceof Conflict)) throw err;
    }
  }
  throw new ApiError(500, "Couldn't create your order - please try again");
}

/** Checkout (signed-in shoppers only): re-price the cart, validate contact + address, open a Razorpay order, save ours as pending. */
export const POST = handle(async (ctx) => {
  const data = await ctx.body();
  const q = quote(data.items, await hiddenNow(ctx.store)); // switched-off products can't be ordered
  const customer = cleanContact(data.customer);
  const address = cleanAddress(data.address);
  // Ordering needs an account (like Amazon): the order is linked to it and shows under "Your account".
  const user = await ctx.requireUser();
  const userId = user.id;

  // Team test accounts (users.is_tester - the co-founders) skip payment. The order is saved as paid but labelled
  // "Test" everywhere. It's the account that counts, never the phone number typed in: anyone can type a number.
  if (user.is_tester) {
    const order = await save(ctx, q, customer, address, "bypass", userId, (o) => {
      Object.assign(o, withStatus(o, "paid", "Team test account - payment skipped, test order", { payment: { method: "test", skipped: true } }));
    });
    return json({ order: { id: order.id, token: order.token, total: order.total }, payment: { gateway: "bypass" }, test_mode: true }, 201);
  }

  const gw = ctx.gateway;
  let rzp: RazorpayOrder = { id: "", amount: 0 };
  const order = await save(ctx, q, customer, address, ctx.gatewayLabel, userId, async (o) => {
    rzp = await gw.createOrder(o.total * 100, o.id, { kp_order: o.id, customer: customer.name.slice(0, 60) });
    o.razorpay_order_id = rzp.id;
  });
  return json({ order: { id: order.id, token: order.token, total: order.total },
    payment: gw.checkoutOptions(order, rzp, `${ctx.origin}/icon-192.png`), test_mode: ctx.cfg.testMode }, 201);
});
