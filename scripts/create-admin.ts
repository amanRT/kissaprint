// Create an admin account, or promote an existing one (sets users.is_admin = true).
//   npm run create-admin -- --email you@example.com --name "Your Name"            (asks for a password)
//   npm run create-admin -- --email you@example.com --name "Your Name" --password "..."
//   add --tester for a team test account: its orders skip payment and show as Test orders (users.is_tester)
// Uses the same settings as the site (.env): Supabase if configured, otherwise the local .data/ store.
// Alternative in Supabase: sign up on the site, then run
//   update public.users set is_admin = true where email = 'you@example.com';
import "../src/lib/server/ipv4-first"; // some home routers stall on IPv6 lookups (see that file)
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { settings } from "../src/lib/server/config";
import { hashPassword, PASSWORD_MIN } from "../src/lib/server/passwords";
import { makeStore } from "../src/lib/server/store";

if (existsSync(".env") && !process.env.KP_NO_DOTENV) process.loadEnvFile(".env");

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  out._writeToOutput = (s: string) => { if (s.startsWith(question)) out.output.write(s); };
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); }));
}

async function main() {
  const email = (arg("email") ?? "").trim().toLowerCase();
  const name = (arg("name") ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Usage: npm run create-admin -- --email you@example.com --name "Your Name" [--password ...]');
  const tester = process.argv.includes("--tester");
  const store = makeStore(settings());
  if (!store) throw new Error("No store configured (set SUPABASE_URL + SUPABASE_SECRET_KEY, or run locally)");

  const existing = await store.getUserByEmail(email);
  if (existing) {
    // Promote, and bump token_version so any session issued before the change has to log in again.
    await store.updateUser(existing.id, { is_admin: true, ...(tester ? { is_tester: true } : {}), token_version: existing.token_version + 1 });
    console.log(`${email} is now an admin${tester ? " and a test account" : ""} (${store.kind} store). Log in again to get admin access.`);
    return;
  }
  const password = arg("password") ?? (await askHidden(`Password for ${email} (${PASSWORD_MIN}+ characters): `));
  if (password.length < PASSWORD_MIN) throw new Error(`Use at least ${PASSWORD_MIN} characters`);
  await store.createUser({ email, name: name || email.split("@")[0], password_hash: await hashPassword(password), is_admin: true, is_tester: tester });
  console.log(`Created admin ${email}${tester ? " (test account)" : ""} (${store.kind} store). Log in at /login/.`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
