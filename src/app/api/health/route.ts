import { handle, json } from "@/lib/server/http";

/** Which features are configured (never the secrets themselves) plus setup mistakes worth fixing. */
export const GET = handle(async ({ cfg }) =>
  json({ ok: true, payments: cfg.payments || "off", storage: cfg.storage || "off", test_mode: cfg.testMode,
    webhook: Boolean(cfg.razorpayWebhookSecret), auth: Boolean(cfg.jwtSecret), problems: cfg.problems }));
