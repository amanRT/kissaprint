// Settings from environment variables: Vercel project settings in production, .env locally (Next loads it).
// Without Razorpay keys or Supabase the backend uses local stand-ins - but only off Vercel: a fake payment step
// and a .data/ folder. On Vercel a missing setting switches that feature off with a clear error instead.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Settings = {
  onVercel: boolean;
  razorpayKeyId: string; razorpayKeySecret: string; razorpayWebhookSecret: string;
  supabaseUrl: string; supabaseKey: string; supabaseBucket: string;
  jwtSecret: string;
  dataDir: string;
  payments: "razorpay" | "mock" | "";
  storage: "supabase" | "local" | "";
  testMode: boolean;
  problems: string[];
};

const clean = (v: string | undefined) => (v ?? "").trim();

export function settings(): Settings {
  const env = process.env;
  const onVercel = Boolean(env.VERCEL);
  const razorpayKeyId = clean(env.RAZORPAY_KEY_ID);
  const razorpayKeySecret = clean(env.RAZORPAY_KEY_SECRET);
  const razorpayWebhookSecret = clean(env.RAZORPAY_WEBHOOK_SECRET);
  // Accept the dashboard's "API URL" too (...supabase.co/rest/v1/): the code adds /rest/v1 and /storage/v1 itself.
  const supabaseUrl = clean(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const supabaseKey = clean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
  const dataDir = clean(env.KP_DATA_DIR) || join(process.cwd(), ".data");
  // Kept in env vars, not in code: the repo is public and these numbers order without paying.

  const payments = razorpayKeyId && razorpayKeySecret ? "razorpay" : onVercel ? "" : "mock";
  const storage = supabaseUrl && supabaseKey && !supabaseKey.startsWith("sb_publishable_") ? "supabase" : onVercel ? "" : "local";
  const jwtSecret = clean(env.JWT_SECRET) || (onVercel ? "" : localSecret(dataDir));

  const problems: string[] = [];
  if (supabaseKey.startsWith("sb_publishable_")) problems.push("SUPABASE_SECRET_KEY holds the publishable key - use the secret key (sb_secret_...)");
  if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) problems.push("Set both SUPABASE_URL and SUPABASE_SECRET_KEY");
  if (Boolean(razorpayKeyId) !== Boolean(razorpayKeySecret)) problems.push("Set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET");
  else if (razorpayKeyId && !/^rzp_(test|live)_/.test(razorpayKeyId)) problems.push("RAZORPAY_KEY_ID should start with rzp_test_ or rzp_live_");
  if (payments === "razorpay" && !razorpayWebhookSecret) problems.push("RAZORPAY_WEBHOOK_SECRET isn't set - payments work, but orders aren't confirmed if a shopper closes the tab");
  if (!jwtSecret) problems.push("JWT_SECRET isn't set - nobody can log in (use a random string of 32+ characters)");
  else if (jwtSecret.length < 32) problems.push("JWT_SECRET is too short - use at least 32 random characters");

  return {
    onVercel, razorpayKeyId, razorpayKeySecret, razorpayWebhookSecret, supabaseUrl, supabaseKey,
    supabaseBucket: clean(env.SUPABASE_BUCKET) || "order-photos", jwtSecret: jwtSecret.length >= 32 ? jwtSecret : "",
    dataDir, payments, storage,
    testMode: !(payments === "razorpay" && razorpayKeyId.startsWith("rzp_live_")), // false only when real money moves
    problems,
  };
}

/** Local development only: a random signing secret kept in .data/ so logins survive restarts. */
function localSecret(dataDir: string): string {
  const file = join(dataDir, "jwt-secret");
  try {
    if (!existsSync(file)) {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(file, randomBytes(48).toString("hex"));
    }
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}
