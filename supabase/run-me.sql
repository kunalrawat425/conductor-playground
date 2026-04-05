-- ============================================
-- MachhliBazaar: COMPLETE DATABASE SETUP
-- Paste into Supabase SQL Editor → Run
-- ============================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================
-- 1. CORE TABLES
-- ============================================

create table if not exists sellers (
  id uuid primary key default uuid_generate_v4(),
  auth_id uuid unique references auth.users(id),
  name text not null,
  phone text not null unique,
  location text not null default '',
  location_name text not null default '',
  lat numeric(10,7) default null,
  lng numeric(10,7) default null,
  rating_avg numeric(3,2) not null default 0,
  total_orders integer not null default 0,
  has_delivery boolean not null default false,
  delivery_rad numeric(5,1) default null,
  is_admin boolean not null default false,
  flagged boolean not null default false,
  push_subscription jsonb,
  push_enabled boolean default false,
  opens_at time default '05:00',
  closes_at time default '14:00',
  created_at timestamptz not null default now()
);

create table if not exists fish_listings (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references sellers(id) on delete cascade,
  species text not null,
  price numeric(10,2) not null,
  price_unit text not null default 'kg' check (price_unit in ('kg', 'piece', 'dozen')),
  weight_avail numeric(10,2) not null default 0,
  photo_url text,
  listed_date date not null default current_date,
  is_available boolean not null default true,
  pickup_loc text not null default '',
  delivery_avl boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default uuid_generate_v4(),
  listing_id uuid references fish_listings(id),
  species text,
  buyer_phone text not null,
  buyer_addr text,
  quantity numeric(10,2) not null,
  quantity_unit text not null default 'kg' check (quantity_unit in ('kg', 'piece', 'dozen')),
  total_price numeric(10,2) not null default 0,
  platform_fee numeric(10,2) not null default 0,
  status text not null default 'pending'
    check (status in (
      'pre_order', 'pending', 'confirmed', 'paid',
      'picked_up', 'completed', 'declined', 'cancelled', 'refunded'
    )),
  order_type text not null default 'pickup' check (order_type in ('pickup', 'delivery')),
  paid_amount numeric(10,2),
  final_price numeric(10,2),
  refund_amt numeric(10,2),
  payment_type text not null default 'upi',
  created_at timestamptz not null default now()
);

create table if not exists species_ranges (
  id uuid primary key default uuid_generate_v4(),
  species text not null,
  price_unit text not null default 'kg' check (price_unit in ('kg', 'piece', 'dozen')),
  min_price numeric(10,2) not null,
  max_price numeric(10,2) not null,
  updated_by uuid references sellers(id),
  updated_at timestamptz not null default now(),
  unique(species, price_unit)
);

create table if not exists price_logs (
  id uuid primary key default uuid_generate_v4(),
  species text not null,
  price numeric(10,2) not null,
  time_of_day text,
  logged_date date not null default current_date,
  source text
);

-- ============================================
-- 2. BUYERS TABLE (new)
-- ============================================

create table if not exists buyers (
  id uuid primary key default uuid_generate_v4(),
  auth_id uuid unique references auth.users(id),
  phone text not null,
  lat numeric(10,7) default null,
  lng numeric(10,7) default null,
  location_name text,
  push_subscription jsonb,
  push_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Add buyer_id to orders (safe if already exists)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'orders' and column_name = 'buyer_id'
  ) then
    alter table orders add column buyer_id uuid references buyers(id);
  end if;
end $$;

-- ============================================
-- 3. INDEXES
-- ============================================

create index if not exists idx_listings_available on fish_listings(is_available)
  where is_available = true;
create index if not exists idx_listings_seller on fish_listings(seller_id);
create index if not exists idx_orders_listing on orders(listing_id);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_buyer on orders(buyer_phone);
create index if not exists idx_species_ranges_species on species_ranges(species);
create index if not exists idx_buyers_auth on buyers(auth_id);
create index if not exists idx_buyers_phone on buyers(phone);
create index if not exists idx_orders_buyer_id on orders(buyer_id);

-- ============================================
-- 4. ROW LEVEL SECURITY
-- ============================================

alter table sellers enable row level security;
alter table fish_listings enable row level security;
alter table orders enable row level security;
alter table species_ranges enable row level security;
alter table price_logs enable row level security;
alter table buyers enable row level security;

-- Helper functions
create or replace function get_seller_id()
returns uuid as $$
  select id from sellers where auth_id = auth.uid()
$$ language sql security definer;

create or replace function get_buyer_id()
returns uuid as $$
  select id from buyers where auth_id = auth.uid()
$$ language sql security definer;

-- Security definer function for admin check (avoids RLS recursion)
create or replace function is_admin()
returns boolean as $$
  select coalesce(
    (select is_admin from sellers where auth_id = auth.uid()),
    false
  )
$$ language sql security definer;

-- SELLERS policies
drop policy if exists "Anyone can view seller profiles" on sellers;
drop policy if exists "Sellers can update own profile" on sellers;
drop policy if exists "Admins can do anything with sellers" on sellers;
drop policy if exists "Admins can insert sellers" on sellers;
drop policy if exists "Admins can delete sellers" on sellers;

create policy "Anyone can view seller profiles"
  on sellers for select using (true);
create policy "Sellers can update own profile"
  on sellers for update using (auth_id = auth.uid());
create policy "Admins can insert sellers"
  on sellers for insert with check (is_admin());
create policy "Admins can delete sellers"
  on sellers for delete using (is_admin());

-- FISH_LISTINGS policies
drop policy if exists "Anyone can view listings" on fish_listings;
drop policy if exists "Sellers can insert own listings" on fish_listings;
drop policy if exists "Sellers can update own listings" on fish_listings;
drop policy if exists "Sellers can delete own listings" on fish_listings;

create policy "Anyone can view listings"
  on fish_listings for select using (true);
create policy "Sellers can insert own listings"
  on fish_listings for insert with check (seller_id = get_seller_id());
create policy "Sellers can update own listings"
  on fish_listings for update using (seller_id = get_seller_id());
create policy "Sellers can delete own listings"
  on fish_listings for delete using (seller_id = get_seller_id());

-- ORDERS policies
drop policy if exists "Anyone can create orders" on orders;
drop policy if exists "Buyers can view own orders by phone" on orders;
drop policy if exists "Sellers can update orders for their listings" on orders;
drop policy if exists "Buyers can view own orders" on orders;

create policy "Anyone can create orders"
  on orders for insert with check (true);
create policy "Buyers can view own orders by phone"
  on orders for select using (true);
create policy "Sellers can update orders for their listings"
  on orders for update using (
    listing_id in (select id from fish_listings where seller_id = get_seller_id())
    or is_admin()
  );
create policy "Buyers can view own orders"
  on orders for select using (buyer_id = get_buyer_id());

-- SPECIES_RANGES policies
drop policy if exists "Anyone can view species ranges" on species_ranges;
drop policy if exists "Admins can manage species ranges" on species_ranges;

create policy "Anyone can view species ranges"
  on species_ranges for select using (true);
create policy "Admins can manage species ranges"
  on species_ranges for all using (is_admin());

-- PRICE_LOGS policies
drop policy if exists "Anyone can view price logs" on price_logs;
drop policy if exists "Admins can insert price logs" on price_logs;

create policy "Anyone can view price logs"
  on price_logs for select using (true);
create policy "Admins can insert price logs"
  on price_logs for insert with check (is_admin());

-- BUYERS policies
drop policy if exists "Buyers can view own profile" on buyers;
drop policy if exists "Buyers can create own profile" on buyers;
drop policy if exists "Buyers can update own profile" on buyers;
drop policy if exists "Admins can view all buyers" on buyers;

create policy "Buyers can view own profile"
  on buyers for select using (auth_id = auth.uid());
create policy "Buyers can create own profile"
  on buyers for insert with check (auth_id = auth.uid());
create policy "Buyers can update own profile"
  on buyers for update using (auth_id = auth.uid());
create policy "Admins can view all buyers"
  on buyers for select using (is_admin());

-- ============================================
-- 5. ENABLE REALTIME
-- ============================================

alter publication supabase_realtime add table orders;

-- ============================================
-- 6. SEED DATA
-- ============================================

-- Test sellers
insert into sellers (name, phone, location, location_name, lat, lng, has_delivery, delivery_rad, rating_avg, total_orders)
values
  ('Raju Fish Stall', '9876543210', 'Versova Fish Market', 'Versova, Andheri West', 19.1334, 72.8167, true, 3.0, 4.5, 127),
  ('Fresh Catch Mumbai', '9876543211', 'Sassoon Dock', 'Colaba', 18.9067, 72.8347, true, 5.0, 4.2, 89),
  ('Koliwada Fisheries', '9876543212', 'Worli Koliwada', 'Worli', 19.0144, 72.8177, false, null, 4.8, 203)
on conflict (phone) do nothing;

-- Species price ranges
insert into species_ranges (species, price_unit, min_price, max_price)
values
  ('pomfret', 'kg', 400, 700),
  ('surmai', 'kg', 500, 900),
  ('rawas', 'kg', 350, 600),
  ('bangda', 'kg', 100, 200),
  ('bombil', 'kg', 150, 300),
  ('prawns', 'kg', 300, 600),
  ('squid', 'kg', 200, 400),
  ('crab', 'piece', 80, 200),
  ('lobster', 'piece', 400, 800),
  ('rohu', 'kg', 150, 280),
  ('catla', 'kg', 180, 300),
  ('hilsa', 'kg', 800, 1500),
  ('sole', 'kg', 200, 350),
  ('kingfish', 'kg', 400, 700),
  ('sardine', 'kg', 80, 150)
on conflict (species, price_unit) do update set
  min_price = excluded.min_price,
  max_price = excluded.max_price,
  updated_at = now();

-- Fresh listings
do $$
declare
  s1 uuid; s2 uuid; s3 uuid;
begin
  select id into s1 from sellers where phone = '9876543210';
  select id into s2 from sellers where phone = '9876543211';
  select id into s3 from sellers where phone = '9876543212';

  if s1 is not null then
    insert into fish_listings (seller_id, species, price, price_unit, weight_avail, pickup_loc, delivery_avl)
    values
      (s1, 'pomfret', 550, 'kg', 8, 'Versova Fish Market, Stall #12', true),
      (s1, 'surmai', 700, 'kg', 5, 'Versova Fish Market, Stall #12', true),
      (s1, 'bangda', 150, 'kg', 15, 'Versova Fish Market, Stall #12', true);
  end if;

  if s2 is not null then
    insert into fish_listings (seller_id, species, price, price_unit, weight_avail, pickup_loc, delivery_avl)
    values
      (s2, 'rawas', 450, 'kg', 10, 'Sassoon Dock Gate 2', true),
      (s2, 'prawns', 500, 'kg', 6, 'Sassoon Dock Gate 2', true);
  end if;

  if s3 is not null then
    insert into fish_listings (seller_id, species, price, price_unit, weight_avail, pickup_loc, delivery_avl)
    values
      (s3, 'pomfret', 600, 'kg', 4, 'Worli Koliwada Market', false),
      (s3, 'hilsa', 1200, 'kg', 2, 'Worli Koliwada Market', false),
      (s3, 'crab', 150, 'piece', 20, 'Worli Koliwada Market', false);
  end if;
end $$;

-- ============================================
-- 7. MOCK BUYERS
-- ============================================

insert into buyers (phone, lat, lng, location_name)
values
  ('9900110011', 19.1200, 72.8300, 'Andheri West'),
  ('9900110022', 18.9700, 72.8200, 'Dadar'),
  ('9900110033', 19.0600, 72.8400, 'Bandra West'),
  ('9900110044', 19.1400, 72.8100, 'Versova'),
  ('9900110055', 18.9200, 72.8300, 'Colaba')
on conflict do nothing;

-- ============================================
-- 8. MOCK ORDERS (various statuses)
-- ============================================

do $$
declare
  s1 uuid; s2 uuid; s3 uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid;
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; b5 uuid;
begin
  select id into s1 from sellers where phone = '9876543210';
  select id into s2 from sellers where phone = '9876543211';
  select id into s3 from sellers where phone = '9876543212';

  -- Get listing IDs
  select id into l1 from fish_listings where seller_id = s1 and species = 'pomfret' limit 1;
  select id into l2 from fish_listings where seller_id = s1 and species = 'surmai' limit 1;
  select id into l3 from fish_listings where seller_id = s1 and species = 'bangda' limit 1;
  select id into l4 from fish_listings where seller_id = s2 and species = 'rawas' limit 1;
  select id into l5 from fish_listings where seller_id = s3 and species = 'crab' limit 1;

  -- Get buyer IDs
  select id into b1 from buyers where phone = '9900110011';
  select id into b2 from buyers where phone = '9900110022';
  select id into b3 from buyers where phone = '9900110033';
  select id into b4 from buyers where phone = '9900110044';
  select id into b5 from buyers where phone = '9900110055';

  if l1 is not null and b1 is not null then
    -- Pending order: buyer in Andheri wants pomfret pickup
    insert into orders (listing_id, species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type)
    values (l1, 'pomfret', '9900110011', b1, 2, 'kg', 1100, 'pending', 'pickup', 'cod');

    -- Confirmed order: buyer in Dadar wants surmai delivery
    insert into orders (listing_id, species, buyer_phone, buyer_id, buyer_addr, quantity, quantity_unit, total_price, status, order_type, payment_type)
    values (l2, 'surmai', '9900110022', b2, '42 Shivaji Park, Dadar West', 1, 'kg', 700, 'confirmed', 'delivery', 'cod');

    -- Completed order: bangda pickup (yesterday)
    insert into orders (listing_id, species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type, created_at)
    values (l3, 'bangda', '9900110033', b3, 3, 'kg', 450, 'completed', 'pickup', 'cod', now() - interval '1 day');

    -- Cancelled order
    insert into orders (listing_id, species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type, created_at)
    values (l1, 'pomfret', '9900110044', b4, 1, 'kg', 550, 'cancelled', 'pickup', 'cod', now() - interval '2 hours');
  end if;

  if l4 is not null and b5 is not null then
    -- Pending delivery order from Colaba buyer
    insert into orders (listing_id, species, buyer_phone, buyer_id, buyer_addr, quantity, quantity_unit, total_price, status, order_type, payment_type)
    values (l4, 'rawas', '9900110055', b5, '12 Shahid Bhagat Singh Rd, Colaba', 2, 'kg', 900, 'pending', 'delivery', 'cod');
  end if;

  if l5 is not null and b2 is not null then
    -- Pre-order: crabs for tomorrow
    insert into orders (listing_id, species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type, paid_amount)
    values (l5, 'crab', '9900110022', b2, 5, 'piece', 750, 'pre_order', 'pickup', 'cod', 750);
  end if;

  -- Species-only pre-order (no listing)
  if b3 is not null then
    insert into orders (species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type, paid_amount)
    values ('lobster', '9900110033', b3, 2, 'piece', 1600, 'pre_order', 'pickup', 'cod', 1600);
  end if;

  -- Declined order (from yesterday)
  if l1 is not null and b5 is not null then
    insert into orders (listing_id, species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type, created_at)
    values (l1, 'pomfret', '9900110055', b5, 5, 'kg', 2750, 'declined', 'pickup', 'cod', now() - interval '1 day');
  end if;
end $$;

-- Update seller total_orders to reflect mock orders
update sellers set total_orders = (
  select count(*) from orders o
  join fish_listings fl on o.listing_id = fl.id
  where fl.seller_id = sellers.id
);

-- ============================================
-- DONE! Expected results:
--   ✅ 6 tables: sellers, fish_listings, orders, species_ranges, price_logs, buyers
--   ✅ 3 sellers with map locations
--   ✅ 8 fresh listings
--   ✅ 15 species with price ranges
--   ✅ 5 mock buyers across Mumbai
--   ✅ 8 mock orders (pending, confirmed, completed, cancelled, declined, pre_order)
--   ✅ RLS policies for all tables
--   ✅ Realtime enabled on orders
-- ============================================
