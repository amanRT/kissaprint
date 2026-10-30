// Password hashing with scrypt (memory-hard, built into Node - no native add-ons to install on Vercel).
// Stored as scrypt$N$r$p$salt$hash (base64url), so the cost can be raised later without breaking old hashes.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 16384, R = 8, P = 1, KEYLEN = 64;
const scrypt = (password: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, KEYLEN, options, (err, key) => (err ? reject(err) : resolve(key))));
const opts = (n: number, r: number, p: number) => ({ N: n, r, p, maxmem: 128 * n * r * 2 });

export const PASSWORD_MIN = 8;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, opts(N, R, P));
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = (stored || "").split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  try {
    const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), opts(Number(n), Number(r), Number(p)));
    const expected = Buffer.from(hash, "base64url");
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Spent on unknown emails too, so response times don't reveal which emails have accounts.
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(12).toString("hex")));
