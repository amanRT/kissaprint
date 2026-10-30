-- KissaPrints database: users, orders and the private photo bucket.
-- Run in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run. Safe to run again (it only adds what's missing).

-- ---------------------------------------------------------------- users
-- Log-in accounts. is_admin decides who can open /admin/; the JWT carries a copy (isAdmin), and admin requests
-- re-check this column, so changing it takes effect immediately. Make someone an admin:
--   update public.users set is_admin = true where email = 'you@example.com';
-- token_version is copied into every JWT; bump it to sign that user out everywhere:
--   update public.users set token_version = token_version + 1 where email = 'you@example.com';
create table if not exists public.users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique check (email = lower(email)),
  name           text not null default '',
  password_hash  text not null,                     -- scrypt$N$r$p$salt$hash, never the password itself
  is_admin       boolean not null default false,
  token_version  integer not null default 0,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

-- Team test accounts (the co-founders): their orders skip payment and are always labelled "Test" in the admin.
-- Everyone else's orders are real. Set with `npm run create-admin -- ... --tester`, or:
--   update public.users set is_tester = true where email = 'you@example.com';
alter table public.users add column if not exists is_tester boolean not null default false;

-- ---------------------------------------------------------------- orders
create table if not exists public.orders (
  id                  text primary key,                 -- KP-7XK2QD
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  status              text not null default 'pending'
                      check (status in ('pending', 'paid', 'printing', 'shipped', 'delivered', 'cancelled', 'refunded')),
  customer            jsonb not null,                   -- {name, phone, email}
  address             jsonb not null,                   -- {line1, line2, city, state, pincode}
  items               jsonb not null,                   -- priced lines incl. options, caption and photo keys
  subtotal            integer not null,                 -- rupees, GST included
  shipping            integer not null,
  total               integer not null,
  currency            text not null default 'INR',
  gateway             text not null,                    -- razorpay | razorpay_test | mock | bypass (the last three are tests)
  razorpay_order_id   text unique,
  razorpay_payment_id text,
  payment             jsonb,
  tracking            jsonb,                            -- {courier, number, url}
  notes               text not null default '',         -- internal, never shown to customers
  history             jsonb not null default '[]'::jsonb,
  token               text not null                     -- secret for the customer's order link
);
-- Orders placed while logged in (shown under "Your account"). Added separately so older databases get it too.
alter table public.orders add column if not exists user_id uuid references public.users (id) on delete set null;

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_updated_at_idx on public.orders (updated_at desc);  -- the dashboard's 30-second "anything new?" check
create index if not exists orders_user_id_idx on public.orders (user_id);

-- ---------------------------------------------------------------- cart + wishlist
-- Saved to the account, so nothing about the shopper is kept in the browser (no localStorage) and the cart follows
-- them to any device. The checkout re-prices and re-checks every line, so a stale cart can never under-charge.
create table if not exists public.carts (
  user_id     uuid primary key references public.users (id) on delete cascade,
  items       jsonb not null default '[]'::jsonb,
  wishlist    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- product visibility
-- Set from /admin/products/. Products without a row are on the website; hidden ones disappear from every page
-- and can't be ordered (e.g. out of stock). The catalog itself (names, prices) lives in src/data/catalog.json.
create table if not exists public.product_settings (
  slug        text primary key,
  hidden      boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);

-- Only the server (secret / service_role key) may touch these tables: RLS on, no policies, no public grants.
alter table public.users enable row level security;
alter table public.orders enable row level security;
alter table public.product_settings enable row level security;
alter table public.carts enable row level security;
revoke all on table public.users from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.product_settings from anon, authenticated;
revoke all on table public.carts from anon, authenticated;
grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.orders to service_role;
grant select, insert, update, delete on table public.product_settings to service_role;
grant select, insert, update, delete on table public.carts to service_role;

-- ---------------------------------------------------------------- photos
-- Private bucket for customer photos (25 MB max, photos only). Uploads use one-time signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-photos', 'order-photos', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
