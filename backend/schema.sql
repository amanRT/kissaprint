-- KissaPrints orders + photo storage. Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run again.

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
  gateway             text not null,
  razorpay_order_id   text unique,
  razorpay_payment_id text,
  payment             jsonb,
  tracking            jsonb,                            -- {courier, number, url}
  notes               text not null default '',         -- internal, never shown to customers
  history             jsonb not null default '[]'::jsonb,
  token               text not null                     -- secret for the customer's order link
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_updated_at_idx on public.orders (updated_at desc);  -- the dashboard's 30-second "anything new?" check

-- Only the server (secret / service_role key) may touch orders: RLS on, no policies, no public grants.
alter table public.orders enable row level security;
revoke all on table public.orders from anon, authenticated;
grant select, insert, update, delete on table public.orders to service_role;

-- Private bucket for customer photos (25 MB max, photos only). Uploads use one-time signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-photos', 'order-photos', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
