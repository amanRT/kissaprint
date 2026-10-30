// Where orders, customer photos and user accounts live.
// - SupabaseStore (production): Postgres tables via the REST API, photos in a private Storage bucket. Browsers
//   upload photos straight to Storage with one-time signed URLs (Vercel caps request bodies at 4.5 MB).
// - LocalStore (development): JSON files and photos under .data/.
// Table and bucket setup: supabase/schema.sql.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Settings } from "./config";
import { ORDER_ID, type Order, type Status } from "./orders";
import { PHOTO_KEY } from "./pricing";

export const MAX_PHOTO_MB = 25;
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };
export const PHOTO_MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" };

export class StoreError extends Error {}
/** A row with this ID / email already exists. */
export class Conflict extends StoreError {}

export type User = {
  id: string; email: string; name: string; password_hash: string; is_admin: boolean; is_tester?: boolean;
  token_version: number; created_at: string; last_login_at: string | null;
};
export type NewUser = Pick<User, "email" | "name" | "password_hash"> & { is_admin?: boolean; is_tester?: boolean };
export type UploadTarget = { key: string; method: "PUT"; url: string; headers: Record<string, string> };
/** A shopper's cart lines (as the browser shows them) and wishlist slugs, kept on the account. */
export type SavedCart = { items: unknown[]; wishlist: string[] };
/** Admin-controlled product state. Only products someone has changed have a row; everything else is visible. */
export type ProductSetting = { slug: string; hidden: boolean; updated_at: string; updated_by: string };
export type ListOptions = { statuses?: readonly Status[] | null; q?: string; limit?: number; oldestFirst?: boolean; userId?: string };

export interface Store {
  kind: "local" | "supabase";
  createOrder(order: Order): Promise<Order>;
  getOrder(id: string): Promise<Order | null>;
  findByRazorpayOrder(razorpayOrderId: string): Promise<Order | null>;
  /** Apply `changes`; with `expect`, only if the current status is one of those (else null). */
  updateOrder(id: string, changes: Partial<Order>, expect?: readonly Status[]): Promise<Order | null>;
  listOrders(options?: ListOptions): Promise<Order[]>;
  statusCounts(): Promise<Record<string, number>>;
  latestChange(): Promise<string>;
  deleteOrder(id: string): Promise<void>;
  uploadTargets(files: [string, string][]): Promise<UploadTarget[]>;
  photoUrls(keys: string[]): Promise<Record<string, string>>;
  deletePhotos(keys: string[]): Promise<void>;
  createUser(user: NewUser): Promise<User>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  updateUser(id: string, changes: Partial<User>): Promise<User | null>;
  getCart(userId: string): Promise<SavedCart>;
  /** Upsert; only the parts given change. */
  saveCart(userId: string, cart: Partial<SavedCart>): Promise<void>;
  productSettings(): Promise<ProductSetting[]>;
  setProductHidden(slug: string, hidden: boolean, by: string): Promise<ProductSetting>;
}

/** -> [storage key, content type]. Throws for files that aren't supported photos. */
export function newPhotoKey(filename: string, contentType: string): [string, string] {
  let ctype = (contentType || "").toLowerCase();
  let ext = PHOTO_TYPES[ctype];
  if (!ext) { // some phones send HEIC with an empty type
    const suffix = (filename.split(".").pop() || "").toLowerCase();
    ext = suffix === "jpeg" ? "jpg" : suffix;
    if (!PHOTO_MIME[ext] || !filename.includes(".")) throw new Error("Please add JPG, PNG, WebP or HEIC photos");
    ctype = PHOTO_MIME[ext];
  }
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return [`up/${day}/${randomUUID().replace(/-/g, "")}.${ext}`, ctype];
}

const matches = (o: Order, q: string) => [o.id, o.customer.name, o.customer.phone, o.customer.email].some((s) => s.toLowerCase().includes(q));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LocalStore implements Store {
  kind = "local" as const;
  private orders: string;
  private uploads: string;
  private usersFile: string;
  private productsFile: string;
  private cartsFile: string;
  private secret: Buffer;

  constructor(root: string) {
    this.orders = join(root, "orders");
    this.uploads = join(root, "uploads");
    this.usersFile = join(root, "users.json");
    this.productsFile = join(root, "products.json");
    this.cartsFile = join(root, "carts.json");
    const secretFile = join(root, "local-secret");
    if (!existsSync(secretFile)) {
      mkdirSync(root, { recursive: true });
      writeFileSync(secretFile, randomBytes(32).toString("hex"));
    }
    this.secret = Buffer.from(readFileSync(secretFile, "utf8").trim());
  }

  private path = (id: string) => (ORDER_ID.test(id || "") ? join(this.orders, `${id}.json`) : null);
  private write(file: string, data: unknown) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file + ".tmp", JSON.stringify(data, null, 1));
    renameSync(file + ".tmp", file);
  }
  private all(): Order[] {
    if (!existsSync(this.orders)) return [];
    return readdirSync(this.orders).filter((f) => /^KP-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(this.orders, f), "utf8")));
  }

  async createOrder(order: Order) {
    const file = this.path(order.id)!;
    if (existsSync(file)) throw new Conflict(order.id);
    this.write(file, order);
    return order;
  }
  async getOrder(id: string) {
    const file = this.path(id);
    return file && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Order) : null;
  }
  async findByRazorpayOrder(rid: string) { return this.all().find((o) => o.razorpay_order_id === rid) ?? null; }
  async updateOrder(id: string, changes: Partial<Order>, expect?: readonly Status[]) {
    const order = await this.getOrder(id);
    if (!order || (expect && !expect.includes(order.status))) return null;
    const next = { ...order, ...changes };
    this.write(this.path(id)!, next);
    return next;
  }
  async listOrders({ statuses, q = "", limit = 200, oldestFirst = false, userId }: ListOptions = {}) {
    let rows = this.all().sort((a, b) => (oldestFirst ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
    if (statuses) rows = rows.filter((o) => statuses.includes(o.status));
    if (userId) rows = rows.filter((o) => o.user_id === userId);
    if (q) rows = rows.filter((o) => matches(o, q.toLowerCase()));
    return rows.slice(0, limit);
  }
  async statusCounts() {
    return this.all().reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.status]: (acc[o.status] ?? 0) + 1 }), {});
  }
  async latestChange() { return this.all().reduce((max, o) => (o.updated_at > max ? o.updated_at : max), ""); }
  async deleteOrder(id: string) { const file = this.path(id); if (file) rmSync(file, { force: true }); }

  private sig = (key: string) => createHmac("sha256", this.secret).update(key).digest("hex");
  async uploadTargets(files: [string, string][]) {
    return files.map(([key, ctype]) => ({ key, method: "PUT" as const, headers: { "Content-Type": ctype }, url: `/api/upload-local/?key=${encodeURIComponent(key)}&sig=${this.sig(key)}` }));
  }
  validUpload(key: string, sig: string) {
    if (!PHOTO_KEY.test(key || "")) return false;
    const a = Buffer.from(this.sig(key)), b = Buffer.from(sig || "");
    return a.length === b.length && timingSafeEqual(a, b);
  }
  saveUpload(key: string, data: Buffer) { const file = join(this.uploads, key); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); }
  readPhoto(key: string) { const file = join(this.uploads, key); return PHOTO_KEY.test(key || "") && existsSync(file) ? readFileSync(file) : null; }
  async photoUrls(keys: string[]) { return Object.fromEntries(keys.map((k) => [k, `/api/admin/photo/?key=${encodeURIComponent(k)}`])); }
  async deletePhotos(keys: string[]) { keys.filter((k) => PHOTO_KEY.test(k)).forEach((k) => rmSync(join(this.uploads, k), { force: true })); }

  private users(): User[] { return existsSync(this.usersFile) ? JSON.parse(readFileSync(this.usersFile, "utf8")) : []; }
  async createUser(u: NewUser) {
    const users = this.users();
    if (users.some((x) => x.email === u.email)) throw new Conflict(u.email);
    const user: User = { id: randomUUID(), email: u.email, name: u.name, password_hash: u.password_hash, is_admin: Boolean(u.is_admin), is_tester: Boolean(u.is_tester),
      token_version: 0, created_at: new Date().toISOString(), last_login_at: null };
    this.write(this.usersFile, [...users, user]);
    return user;
  }
  async getUserByEmail(email: string) { return this.users().find((u) => u.email === email) ?? null; }
  async getUserById(id: string) { return this.users().find((u) => u.id === id) ?? null; }
  async updateUser(id: string, changes: Partial<User>) {
    const users = this.users();
    const i = users.findIndex((u) => u.id === id);
    if (i < 0) return null;
    users[i] = { ...users[i], ...changes, id };
    this.write(this.usersFile, users);
    return users[i];
  }

  private carts(): Record<string, SavedCart> { return existsSync(this.cartsFile) ? JSON.parse(readFileSync(this.cartsFile, "utf8")) : {}; }
  async getCart(userId: string) { return this.carts()[userId] ?? { items: [], wishlist: [] }; }
  async saveCart(userId: string, cart: Partial<SavedCart>) {
    const all = this.carts();
    all[userId] = { ...(all[userId] ?? { items: [], wishlist: [] }), ...cart };
    this.write(this.cartsFile, all);
  }

  async productSettings(): Promise<ProductSetting[]> { return existsSync(this.productsFile) ? JSON.parse(readFileSync(this.productsFile, "utf8")) : []; }
  async setProductHidden(slug: string, hidden: boolean, by: string) {
    const row: ProductSetting = { slug, hidden, updated_at: new Date().toISOString(), updated_by: by };
    this.write(this.productsFile, [...(await this.productSettings()).filter((r) => r.slug !== slug), row]);
    return row;
  }
}

export class SupabaseStore implements Store {
  kind = "supabase" as const;
  constructor(private url: string, private key: string, private bucket: string) {}

  private async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<[number, unknown]> {
    const hdrs: Record<string, string> = { apikey: this.key, "Content-Type": "application/json", ...headers };
    if (this.key.startsWith("eyJ")) hdrs.Authorization = `Bearer ${this.key}`; // legacy service_role JWT also goes here
    let res: Response;
    try {
      res = await fetch(this.url + path, { method, headers: hdrs, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000), cache: "no-store" });
    } catch {
      throw new StoreError("Couldn't reach Supabase");
    }
    const raw = await res.text();
    let data: unknown = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: raw.slice(0, 200) }; }
    return [res.status, data];
  }
  private ok<T>([status, data]: [number, unknown], what: string): T {
    if (status >= 300) {
      const msg = data && typeof data === "object" ? ((data as { message?: string; error?: string }).message || (data as { error?: string }).error || "") : "";
      throw new StoreError(`${what} failed (HTTP ${status}${msg ? `: ${msg}` : ""})`);
    }
    return data as T;
  }
  private q = (v: string) => encodeURIComponent(v);

  async createOrder(order: Order) {
    const res = await this.req("POST", "/rest/v1/orders", order, { Prefer: "return=representation" });
    if (res[0] === 409) throw new Conflict(order.id);
    return this.ok<Order[]>(res, "Saving the order")[0];
  }
  private async one(column: string, value: string) {
    const rows = this.ok<Order[]>(await this.req("GET", `/rest/v1/orders?select=*&${column}=eq.${this.q(value)}`), "Loading the order");
    return rows[0] ?? null;
  }
  async getOrder(id: string) { return ORDER_ID.test(id || "") ? this.one("id", id) : null; }
  async findByRazorpayOrder(rid: string) { return this.one("razorpay_order_id", rid); }
  async updateOrder(id: string, changes: Partial<Order>, expect?: readonly Status[]) {
    // conditional update = safe against the browser and the webhook racing each other
    let path = `/rest/v1/orders?id=eq.${this.q(id)}`;
    if (expect) path += `&status=in.(${expect.join(",")})`;
    const rows = this.ok<Order[]>(await this.req("PATCH", path, changes, { Prefer: "return=representation" }), "Updating the order");
    return rows[0] ?? null;
  }
  async listOrders({ statuses, q = "", limit = 200, oldestFirst = false, userId }: ListOptions = {}) {
    let params = `select=*&order=created_at.${oldestFirst ? "asc" : "desc"}&limit=${Math.floor(limit)}`;
    if (statuses) params += `&status=in.(${statuses.join(",")})`;
    if (userId && UUID.test(userId)) params += `&user_id=eq.${userId}`;
    const safe = (q || "").replace(/[^\w@.+\- ]/g, "").trim().slice(0, 60);
    if (safe) {
      const pat = `*${safe}*`;
      params += "&or=" + this.q(`(id.ilike.${pat},customer->>name.ilike.${pat},customer->>phone.ilike.${pat},customer->>email.ilike.${pat})`);
    }
    return this.ok<Order[]>(await this.req("GET", "/rest/v1/orders?" + params), "Loading orders");
  }
  async statusCounts() {
    const rows = this.ok<{ status: string }[]>(await this.req("GET", "/rest/v1/orders?select=status&limit=10000"), "Counting orders");
    return rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  }
  async latestChange() {
    const rows = this.ok<{ updated_at: string }[]>(await this.req("GET", "/rest/v1/orders?select=updated_at&order=updated_at.desc&limit=1"), "Checking for changes");
    return rows[0]?.updated_at ?? "";
  }
  async deleteOrder(id: string) {
    if (ORDER_ID.test(id || "")) this.ok(await this.req("DELETE", `/rest/v1/orders?id=eq.${this.q(id)}`), "Deleting the order");
  }

  async uploadTargets(files: [string, string][]) {
    return Promise.all(files.map(async ([key, ctype]) => {
      const data = this.ok<{ url: string }>(await this.req("POST", `/storage/v1/object/upload/sign/${this.bucket}/${key}`, {}), "Preparing the photo upload");
      return { key, method: "PUT" as const, url: `${this.url}/storage/v1${data.url}`, headers: { "Content-Type": ctype, "x-upsert": "false" } };
    }));
  }
  async photoUrls(keys: string[], expiresIn = 3600) {
    if (!keys.length) return {};
    const rows = this.ok<{ path: string; signedURL?: string }[]>(await this.req("POST", `/storage/v1/object/sign/${this.bucket}`, { expiresIn, paths: keys }), "Loading photos");
    return Object.fromEntries(rows.filter((r) => r.signedURL).map((r) => [r.path, `${this.url}/storage/v1${r.signedURL}`]));
  }
  async deletePhotos(keys: string[]) {
    const valid = keys.filter((k) => PHOTO_KEY.test(k));
    if (valid.length) this.ok(await this.req("DELETE", `/storage/v1/object/${this.bucket}`, { prefixes: valid }), "Deleting photos");
  }

  async createUser(u: NewUser) {
    const res = await this.req("POST", "/rest/v1/users", { email: u.email, name: u.name, password_hash: u.password_hash, is_admin: Boolean(u.is_admin), ...(u.is_tester ? { is_tester: true } : {}) }, { Prefer: "return=representation" });
    if (res[0] === 409) throw new Conflict(u.email);
    return this.ok<User[]>(res, "Creating the account")[0];
  }
  private async user(column: string, value: string) {
    const rows = this.ok<User[]>(await this.req("GET", `/rest/v1/users?select=*&${column}=eq.${this.q(value)}`), "Loading the account");
    return rows[0] ?? null;
  }
  async getUserByEmail(email: string) { return this.user("email", email); }
  async getUserById(id: string) { return UUID.test(id) ? this.user("id", id) : null; }
  async updateUser(id: string, changes: Partial<User>) {
    if (!UUID.test(id)) return null;
    const rows = this.ok<User[]>(await this.req("PATCH", `/rest/v1/users?id=eq.${id}`, changes, { Prefer: "return=representation" }), "Updating the account");
    return rows[0] ?? null;
  }

  async getCart(userId: string): Promise<SavedCart> {
    if (!UUID.test(userId)) return { items: [], wishlist: [] };
    const rows = this.ok<SavedCart[]>(await this.req("GET", `/rest/v1/carts?select=items,wishlist&user_id=eq.${userId}`), "Loading the cart");
    return rows[0] ?? { items: [], wishlist: [] };
  }
  async saveCart(userId: string, cart: Partial<SavedCart>) {
    if (!UUID.test(userId)) return;
    this.ok(await this.req("POST", "/rest/v1/carts?on_conflict=user_id", { user_id: userId, ...cart, updated_at: new Date().toISOString() },
      { Prefer: "resolution=merge-duplicates,return=minimal" }), "Saving the cart");
  }

  async productSettings() {
    return this.ok<ProductSetting[]>(await this.req("GET", "/rest/v1/product_settings?select=slug,hidden,updated_at,updated_by"), "Loading product settings");
  }
  async setProductHidden(slug: string, hidden: boolean, by: string) {
    const row = { slug, hidden, updated_at: new Date().toISOString(), updated_by: by };
    const res = await this.req("POST", "/rest/v1/product_settings?on_conflict=slug", row, { Prefer: "resolution=merge-duplicates,return=representation" });
    return this.ok<ProductSetting[]>(res, "Saving the product setting")[0];
  }
}

export function makeStore(cfg: Settings): Store | null {
  if (cfg.storage === "supabase") return new SupabaseStore(cfg.supabaseUrl, cfg.supabaseKey, cfg.supabaseBucket);
  if (cfg.storage === "local") return new LocalStore(cfg.dataDir);
  return null;
}
