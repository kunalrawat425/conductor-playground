-- MachhliBazaar: Fish Marketplace MVP
-- Initial schema + RLS policies

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================
-- TABLES
-- ============================================

create table sellers (
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
  delivery_rad numeric(5,1) default null, -- km, display-only
  is_admin boolean not null default false,
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);

create table fish_listings (
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

create table orders (
  id uuid primary key default uuid_generate_v4(),
  listing_id uuid references fish_listings(id),
  species text, -- for pre-orders that don't have a listing yet
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
  paid_amount numeric(10,2), -- for pre-orders: max range price paid upfront
  final_price numeric(10,2), -- for pre-orders: actual price set by seller
  refund_amt numeric(10,2), -- difference refunded to buyer
  payment_type text not null default 'upi',
  created_at timestamptz not null default now()
);

create table species_ranges (
  id uuid primary key default uuid_generate_v4(),
  species text not null,
  price_unit text not null default 'kg' check (price_unit in ('kg', 'piece', 'dozen')),
  min_price numeric(10,2) not null,
  max_price numeric(10,2) not null,
  updated_by uuid references sellers(id),
  updated_at timestamptz not null default now(),
  unique(species, price_unit)
);

create table price_logs (
  id uuid primary key default uuid_generate_v4(),
  species text not null,
  price numeric(10,2) not null,
  time_of_day text,
  logged_date date not null default current_date,
  source text
);

-- ============================================
-- INDEXES
-- ============================================

create index idx_listings_available on fish_listings(is_available)
  where is_available = true;
create index idx_listings_seller on fish_listings(seller_id);
create index idx_orders_listing on orders(listing_id);
create index idx_orders_status on orders(status);
create index idx_orders_buyer on orders(buyer_phone);
create index idx_species_ranges_species on species_ranges(species);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table sellers enable row level security;
alter table fish_listings enable row level security;
alter table orders enable row level security;
alter table species_ranges enable row level security;
alter table price_logs enable row level security;

-- Helper: get seller_id for current auth user
create or replace function get_seller_id()
returns uuid as $$
  select id from sellers where auth_id = auth.uid()
$$ language sql security definer;

-- SELLERS policies
create policy "Anyone can view seller profiles"
  on sellers for select using (true);

create policy "Sellers can update own profile"
  on sellers for update using (auth_id = auth.uid());

create policy "Admins can do anything with sellers"
  on sellers for all using (
    exists (select 1 from sellers where auth_id = auth.uid() and is_admin = true)
  );

-- FISH_LISTINGS policies
create policy "Anyone can view listings"
  on fish_listings for select using (true);

create policy "Sellers can insert own listings"
  on fish_listings for insert with check (seller_id = get_seller_id());

create policy "Sellers can update own listings"
  on fish_listings for update using (seller_id = get_seller_id());

create policy "Sellers can delete own listings"
  on fish_listings for delete using (seller_id = get_seller_id());

-- ORDERS policies
create policy "Anyone can create orders"
  on orders for insert with check (true);

create policy "Buyers can view own orders by phone"
  on orders for select using (true); -- simplified: filter in app logic

create policy "Sellers can update orders for their listings"
  on orders for update using (
    listing_id in (select id from fish_listings where seller_id = get_seller_id())
    or exists (select 1 from sellers where auth_id = auth.uid() and is_admin = true)
  );

-- SPECIES_RANGES policies
create policy "Anyone can view species ranges"
  on species_ranges for select using (true);

create policy "Admins can manage species ranges"
  on species_ranges for all using (
    exists (select 1 from sellers where auth_id = auth.uid() and is_admin = true)
  );

-- PRICE_LOGS policies
create policy "Anyone can view price logs"
  on price_logs for select using (true);

create policy "Admins can insert price logs"
  on price_logs for insert with check (
    exists (select 1 from sellers where auth_id = auth.uid() and is_admin = true)
  );

-- ============================================
-- STORAGE
-- ============================================

-- Run in Supabase dashboard:
-- 1. Create bucket "fish-photos" (public)
-- 2. Enable image transforms
-- MachhliBazaar: Buyer Experience
-- Adds buyers table, buyer_id on orders, push notification support

-- ============================================
-- BUYERS TABLE
-- ============================================

create table buyers (
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

create index idx_buyers_auth on buyers(auth_id);
create index idx_buyers_phone on buyers(phone);

-- ============================================
-- MODIFY ORDERS: add buyer_id
-- ============================================

alter table orders add column buyer_id uuid references buyers(id);
create index idx_orders_buyer_id on orders(buyer_id);

-- ============================================
-- RLS for buyers
-- ============================================

alter table buyers enable row level security;

-- Helper: get buyer_id for current auth user
create or replace function get_buyer_id()
returns uuid as $$
  select id from buyers where auth_id = auth.uid()
$$ language sql security definer;

-- Buyers can read their own record
create policy "Buyers can view own profile"
  on buyers for select using (auth_id = auth.uid());

-- Buyers can insert their own record (at login time)
create policy "Buyers can create own profile"
  on buyers for insert with check (auth_id = auth.uid());

-- Buyers can update their own record (location, push subscription)
create policy "Buyers can update own profile"
  on buyers for update using (auth_id = auth.uid());

-- Admins can view all buyers
create policy "Admins can view all buyers"
  on buyers for select using (
    exists (select 1 from sellers where auth_id = auth.uid() and is_admin = true)
  );

-- ============================================
-- UPDATE ORDERS RLS: buyers can view own orders
-- ============================================

-- Add policy for buyers to view their own orders
create policy "Buyers can view own orders"
  on orders for select using (
    buyer_id = get_buyer_id()
  );
-- Add push notification fields to sellers
alter table sellers add column if not exists push_subscription jsonb;
alter table sellers add column if not exists push_enabled boolean default false;
-- Add operating hours to sellers
alter table sellers add column if not exists opens_at time default '05:00';
alter table sellers add column if not exists closes_at time default '14:00';
-- ============================================
-- FIX: Add missing columns + fix RLS recursion
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Add missing columns to sellers (safe if already exists)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'push_subscription') then
    alter table sellers add column push_subscription jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'push_enabled') then
    alter table sellers add column push_enabled boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'opens_at') then
    alter table sellers add column opens_at time default '05:00';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'closes_at') then
    alter table sellers add column closes_at time default '14:00';
  end if;
end $$;

-- 2. Create is_admin() security definer function (bypasses RLS)
create or replace function is_admin()
returns boolean as $$
  select coalesce(
    (select is_admin from sellers where auth_id = auth.uid()),
    false
  )
$$ language sql security definer;

-- 3. Fix species_ranges RLS (drop old policy, recreate with is_admin())
drop policy if exists "Admins can manage species ranges" on species_ranges;
create policy "Admins can manage species ranges"
  on species_ranges for all using (is_admin());

-- Ensure anon SELECT works
drop policy if exists "Anyone can view species ranges" on species_ranges;
create policy "Anyone can view species ranges"
  on species_ranges for select using (true);

-- 4. Fix price_logs RLS
drop policy if exists "Admins can insert price logs" on price_logs;
create policy "Admins can insert price logs"
  on price_logs for insert with check (is_admin());

drop policy if exists "Anyone can view price logs" on price_logs;
create policy "Anyone can view price logs"
  on price_logs for select using (true);

-- 5. Fix sellers RLS (admin policies)
drop policy if exists "Admins can do anything with sellers" on sellers;
drop policy if exists "Admins can insert sellers" on sellers;
drop policy if exists "Admins can delete sellers" on sellers;

create policy "Admins can insert sellers"
  on sellers for insert with check (is_admin());
create policy "Admins can delete sellers"
  on sellers for delete using (is_admin());

-- Ensure other seller policies exist
drop policy if exists "Anyone can view seller profiles" on sellers;
create policy "Anyone can view seller profiles"
  on sellers for select using (true);

drop policy if exists "Sellers can update own profile" on sellers;
create policy "Sellers can update own profile"
  on sellers for update using (auth_id = auth.uid());

-- 6. Fix orders RLS (admin check was using inline subquery causing recursion)
drop policy if exists "Sellers can update their orders" on orders;
create policy "Sellers can update their orders"
  on orders for update using (
    listing_id in (select id from fish_listings where seller_id = get_seller_id())
    or is_admin()
  );

-- 7. Ensure listings are visible (availability-only model)
update fish_listings
  set is_available = true
  where is_available = true;

-- ============================================
-- DONE! This fixes:
--   ✅ sellers.opens_at / closes_at columns
--   ✅ sellers.push_subscription / push_enabled columns
--   ✅ species_ranges RLS infinite recursion
--   ✅ Listing visibility refreshed
-- ============================================
-- ============================================
-- Add pre-order opt-in for sellers + inventory management
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Add accepts_preorder toggle to sellers
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'accepts_preorder') then
    alter table sellers add column accepts_preorder boolean default true;
  end if;
end $$;

-- 2. Decrement stock immediately when order is placed
create or replace function decrement_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null then
    update fish_listings
    set weight_avail = greatest(weight_avail - NEW.quantity, 0)
    where id = NEW.listing_id;

    -- Auto-mark unavailable when stock hits 0
    update fish_listings
    set is_available = false
    where id = NEW.listing_id
      and weight_avail <= 0;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- 3. Trigger on order INSERT
drop trigger if exists trg_decrement_inventory on orders;
drop trigger if exists trg_restore_inventory on orders;
drop trigger if exists trg_update_inventory on orders;

create trigger trg_decrement_inventory
  after insert on orders
  for each row
  execute function decrement_listing_inventory();

-- 4. Restore stock on cancel/decline
create or replace function restore_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null
    and OLD.status in ('pending', 'pre_order', 'confirmed')
    and NEW.status in ('cancelled', 'declined', 'refunded') then
    update fish_listings
    set weight_avail = weight_avail + OLD.quantity,
        is_available = true
    where id = NEW.listing_id;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- 5. Trigger on order UPDATE (cancel/decline/refund)
create trigger trg_restore_inventory
  after update on orders
  for each row
  execute function restore_listing_inventory();

-- ============================================
-- DONE! This adds:
--   ✅ sellers.accepts_preorder boolean (default true)
--   ✅ Stock decrements immediately when order is placed
--   ✅ Auto-mark listing unavailable when stock = 0
--   ✅ Restore stock on cancel/decline/refund
-- ============================================
-- ============================================
-- COMBINED FIX: Run this in Supabase SQL Editor
-- Includes: 005 (RLS fix) + 006 (preorder + inventory)
-- ============================================

-- =====================
-- FROM 005: Fix RLS recursion + add columns
-- =====================

-- 1. Add missing columns to sellers (safe if already exists)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'push_subscription') then
    alter table sellers add column push_subscription jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'push_enabled') then
    alter table sellers add column push_enabled boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'opens_at') then
    alter table sellers add column opens_at time default '05:00';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'closes_at') then
    alter table sellers add column closes_at time default '14:00';
  end if;
end $$;

-- 2. Create is_admin() security definer function (bypasses RLS)
create or replace function is_admin()
returns boolean as $$
  select coalesce(
    (select is_admin from sellers where auth_id = auth.uid()),
    false
  )
$$ language sql security definer;

-- 3. Fix species_ranges RLS
drop policy if exists "Admins can manage species ranges" on species_ranges;
create policy "Admins can manage species ranges"
  on species_ranges for all using (is_admin());

drop policy if exists "Anyone can view species ranges" on species_ranges;
create policy "Anyone can view species ranges"
  on species_ranges for select using (true);

-- 4. Fix price_logs RLS
drop policy if exists "Admins can insert price logs" on price_logs;
create policy "Admins can insert price logs"
  on price_logs for insert with check (is_admin());

drop policy if exists "Anyone can view price logs" on price_logs;
create policy "Anyone can view price logs"
  on price_logs for select using (true);

-- 5. Fix sellers RLS (remove recursive admin policies)
drop policy if exists "Admins can do anything with sellers" on sellers;
drop policy if exists "Admins can insert sellers" on sellers;
drop policy if exists "Admins can delete sellers" on sellers;

create policy "Admins can insert sellers"
  on sellers for insert with check (is_admin());
create policy "Admins can delete sellers"
  on sellers for delete using (is_admin());

drop policy if exists "Anyone can view seller profiles" on sellers;
create policy "Anyone can view seller profiles"
  on sellers for select using (true);

drop policy if exists "Sellers can update own profile" on sellers;
create policy "Sellers can update own profile"
  on sellers for update using (auth_id = auth.uid());

-- 6. Fix orders RLS
drop policy if exists "Sellers can update their orders" on orders;
create policy "Sellers can update their orders"
  on orders for update using (
    listing_id in (select id from fish_listings where seller_id = get_seller_id())
    or is_admin()
  );

-- 7. Ensure listings are visible (availability-only model)
update fish_listings
  set is_available = true
  where is_available = true;

-- =====================
-- FROM 006: Pre-order + inventory
-- =====================

-- 1. Add accepts_preorder toggle to sellers
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'accepts_preorder') then
    alter table sellers add column accepts_preorder boolean default true;
  end if;
end $$;

-- 2. Decrement stock on order placement
create or replace function decrement_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null then
    update fish_listings
    set weight_avail = greatest(weight_avail - NEW.quantity, 0)
    where id = NEW.listing_id;

    update fish_listings
    set is_available = false
    where id = NEW.listing_id
      and weight_avail <= 0;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- 3. Triggers
drop trigger if exists trg_decrement_inventory on orders;
drop trigger if exists trg_restore_inventory on orders;
drop trigger if exists trg_update_inventory on orders;

create trigger trg_decrement_inventory
  after insert on orders
  for each row
  execute function decrement_listing_inventory();

-- 4. Restore stock on cancel/decline
create or replace function restore_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null
    and OLD.status in ('pending', 'pre_order', 'confirmed')
    and NEW.status in ('cancelled', 'declined', 'refunded') then
    update fish_listings
    set weight_avail = weight_avail + OLD.quantity,
        is_available = true
    where id = NEW.listing_id;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

create trigger trg_restore_inventory
  after update on orders
  for each row
  execute function restore_listing_inventory();

-- ============================================
-- DONE! Copy-paste this entire block into Supabase SQL Editor and run.
-- ============================================
-- Add first_name, last_name, email to sellers and buyers

alter table sellers
  add column if not exists first_name text default '',
  add column if not exists last_name text default '',
  add column if not exists email text default '';

alter table buyers
  add column if not exists first_name text default '',
  add column if not exists last_name text default '',
  add column if not exists email text default '';
-- Saved delivery / pickup addresses per buyer (address book)

create table if not exists buyer_addresses (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references buyers(id) on delete cascade,
  label text not null default '',
  flat text not null default '',
  building text not null default '',
  landmark text not null default '',
  location_name text not null default '',
  lat numeric(10, 7),
  lng numeric(10, 7),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_buyer_addresses_buyer on buyer_addresses(buyer_id);

comment on table buyer_addresses is 'Buyer saved addresses for checkout; API uses service role.';
-- Seller minimum order, delivery fee, free-delivery threshold

alter table sellers add column if not exists min_order_amount numeric(10, 2) not null default 0;
alter table sellers add column if not exists delivery_fee_enabled boolean not null default false;
alter table sellers add column if not exists delivery_fee_amount numeric(10, 2) not null default 0;
alter table sellers add column if not exists free_delivery_above numeric(10, 2);

comment on column sellers.min_order_amount is 'Minimum item subtotal (₹) per order line; 0 = no minimum';
comment on column sellers.delivery_fee_enabled is 'When true, charge delivery_fee_amount on delivery orders unless free_delivery_above met';
comment on column sellers.free_delivery_above is 'Waive delivery fee when subtotal >= this amount (₹); null = no waiver';

alter table orders add column if not exists delivery_fee numeric(10, 2) not null default 0;
-- Remove listing expiry column and related index.
-- Listings are now controlled only by is_available + stock/business rules.

drop index if exists idx_listings_available;
create index if not exists idx_listings_available on fish_listings(is_available)
  where is_available = true;

alter table fish_listings
  drop column if exists expires_at;
-- Unique buyer phone (seller.phone is already unique in 001_initial).
-- Unique non-blank email per table (see 013: replaced with case-sensitive trim-only indexes).

drop index if exists idx_buyers_phone;
create unique index idx_buyers_phone on buyers (phone);

create unique index if not exists buyers_email_lower_unique
  on buyers (lower(trim(email)))
  where trim(coalesce(email, '')) <> '';

create unique index if not exists sellers_email_lower_unique
  on sellers (lower(trim(email)))
  where trim(coalesce(email, '')) <> '';
-- Email uniqueness is case-sensitive (trim whitespace only).
-- Replaces 012 indexes that used lower(trim(email)).

drop index if exists buyers_email_lower_unique;
drop index if exists sellers_email_lower_unique;

create unique index if not exists buyers_email_trim_unique
  on buyers (trim(email))
  where trim(coalesce(email, '')) <> '';

create unique index if not exists sellers_email_trim_unique
  on sellers (trim(email))
  where trim(coalesce(email, '')) <> '';
-- Buyers: active by default (can be deactivated by admin / ops).
-- Sellers: existing rows stay active; new sign-ups default inactive until activated.

alter table buyers add column if not exists is_active boolean not null default true;

alter table sellers add column if not exists is_active boolean;
update sellers set is_active = true where is_active is null;
alter table sellers alter column is_active set not null;
alter table sellers alter column is_active set default false;
-- Buyer waitlist: captures demand before sellers go live in an area
create table if not exists buyer_waitlist (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid references buyers(id),
  phone text not null,
  area text not null,
  fish_wanted text,
  frequency text,
  preference text,
  budget text,
  notes text,
  email_sent boolean default false,
  converted_at timestamptz,
  created_at timestamptz default now(),
  unique(phone, area)
);

create index idx_waitlist_area on buyer_waitlist(area);
create index idx_waitlist_created on buyer_waitlist(created_at desc);
-- Seller schedule: config template + materialized time slots
create table if not exists seller_schedule_configs (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references sellers(id) not null unique,
  date_from date not null,
  date_to date not null,
  start_time time not null,
  end_time time not null,
  slot_duration_minutes int not null default 60,
  created_at timestamptz default now()
);

create table if not exists seller_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references sellers(id) not null,
  slot_date date not null,
  slot_start time not null,
  slot_end time not null,
  is_enabled boolean default true,
  date_disabled boolean default false,
  created_at timestamptz default now(),
  unique(seller_id, slot_date, slot_start)
);

create index idx_schedule_slots_seller_date on seller_schedule_slots(seller_id, slot_date, is_enabled);
-- Add scheduled order support to orders table
alter table orders add column if not exists scheduled_for timestamptz;
alter table orders add column if not exists schedule_slot_id uuid references seller_schedule_slots(id);

-- Add index for efficient scheduled order queries
create index if not exists idx_orders_scheduled on orders(scheduled_for) where scheduled_for is not null;
-- 1. Atomic stock check: replace app-level check with DB function
create or replace function create_order_atomic(
  p_listing_id uuid,
  p_species text,
  p_quantity numeric,
  p_quantity_unit text,
  p_buyer_phone text,
  p_buyer_id uuid,
  p_buyer_addr text,
  p_total_price numeric,
  p_delivery_fee numeric,
  p_status text,
  p_order_type text,
  p_scheduled_for timestamptz,
  p_schedule_slot_id uuid
) returns uuid as $$
declare
  v_order_id uuid;
  v_avail numeric;
begin
  -- Lock the listing row and check stock atomically
  if p_listing_id is not null then
    select weight_avail into v_avail
    from fish_listings
    where id = p_listing_id
    for update;

    if v_avail is null then
      raise exception 'Listing not found';
    end if;

    if v_avail < p_quantity then
      raise exception 'Only % % in stock', v_avail, p_quantity_unit;
    end if;

    -- Decrement stock atomically
    update fish_listings
    set weight_avail = weight_avail - p_quantity
    where id = p_listing_id;
  end if;

  -- Insert order
  insert into orders (
    listing_id, species, quantity, quantity_unit, buyer_phone, buyer_id,
    buyer_addr, total_price, delivery_fee, platform_fee, status, order_type,
    payment_type, paid_amount, scheduled_for, schedule_slot_id
  ) values (
    p_listing_id, p_species, p_quantity, p_quantity_unit, p_buyer_phone, p_buyer_id,
    p_buyer_addr, p_total_price, p_delivery_fee, 0, p_status, p_order_type,
    'cod', case when p_status = 'pre_order' then p_total_price + p_delivery_fee else null end,
    p_scheduled_for, p_schedule_slot_id
  ) returning id into v_order_id;

  return v_order_id;
end;
$$ language plpgsql;

-- 1b. Restore stock on cancel
create or replace function restore_order_stock(p_listing_id uuid, p_quantity numeric)
returns void as $$
begin
  update fish_listings set weight_avail = weight_avail + p_quantity where id = p_listing_id;
end;
$$ language plpgsql;

-- 2. OTP rate limiting table
create table if not exists otp_attempts (
  phone text primary key,
  attempts int default 1,
  first_attempt timestamptz default now(),
  blocked_until timestamptz
);

-- 3. Low stock threshold on sellers
alter table sellers add column if not exists low_stock_threshold numeric default 2;
-- Track who cancelled and why
alter table orders add column if not exists cancelled_by text; -- 'buyer' or 'seller'
alter table orders add column if not exists cancel_reason text;
-- Per-listing order limits
alter table fish_listings add column if not exists max_qty_per_order numeric;
alter table fish_listings add column if not exists max_orders_per_day int;
-- Per-listing out-of-stock threshold (default 10% of initial stock or seller-set value)
alter table fish_listings add column if not exists oos_threshold numeric;
-- Merge max_qty_per_order + max_orders_per_day into one optional per-buyer daily quantity cap.
alter table fish_listings add column if not exists buyer_daily_qty_limit numeric;

-- Prefer per-order cap as the new limit; fall back to old daily order count only if that was set alone.
update fish_listings
set buyer_daily_qty_limit = coalesce(max_qty_per_order, max_orders_per_day::numeric)
where buyer_daily_qty_limit is null
  and (max_qty_per_order is not null or max_orders_per_day is not null);

alter table fish_listings drop column if exists max_qty_per_order;
alter table fish_listings drop column if exists max_orders_per_day;
-- Multiple price tiers per listing: custom labels + piece/dozen unit for stock/orders
alter table fish_listings add column if not exists pricing_options jsonb;

-- Backfill from legacy price + price_unit
update fish_listings
set pricing_options = jsonb_build_array(
  jsonb_build_object(
    'id', 'default',
    'label', case price_unit
      when 'dozen' then 'Per dozen'
      when 'piece' then 'Per piece'
      else 'Per ' || price_unit::text
    end,
    'price', price,
    'unit', price_unit
  )
)
where pricing_options is null;

alter table orders add column if not exists pricing_option_id text;
alter table orders add column if not exists pricing_label text;

-- Extend atomic order insert to store chosen tier
create or replace function create_order_atomic(
  p_listing_id uuid,
  p_species text,
  p_quantity numeric,
  p_quantity_unit text,
  p_buyer_phone text,
  p_buyer_id uuid,
  p_buyer_addr text,
  p_total_price numeric,
  p_delivery_fee numeric,
  p_status text,
  p_order_type text,
  p_scheduled_for timestamptz,
  p_schedule_slot_id uuid,
  p_pricing_option_id text default null,
  p_pricing_label text default null
) returns uuid as $$
declare
  v_order_id uuid;
  v_avail numeric;
begin
  if p_listing_id is not null then
    select weight_avail into v_avail
    from fish_listings
    where id = p_listing_id
    for update;

    if v_avail is null then
      raise exception 'Listing not found';
    end if;

    if v_avail < p_quantity then
      raise exception 'Only % % in stock', v_avail, p_quantity_unit;
    end if;

    update fish_listings
    set weight_avail = weight_avail - p_quantity
    where id = p_listing_id;
  end if;

  insert into orders (
    listing_id, species, quantity, quantity_unit, buyer_phone, buyer_id,
    buyer_addr, total_price, delivery_fee, platform_fee, status, order_type,
    payment_type, paid_amount, scheduled_for, schedule_slot_id,
    pricing_option_id, pricing_label
  ) values (
    p_listing_id, p_species, p_quantity, p_quantity_unit, p_buyer_phone, p_buyer_id,
    p_buyer_addr, p_total_price, p_delivery_fee, 0, p_status, p_order_type,
    'cod', case when p_status = 'pre_order' then p_total_price + p_delivery_fee else null end,
    p_scheduled_for, p_schedule_slot_id,
    p_pricing_option_id, p_pricing_label
  ) returning id into v_order_id;

  return v_order_id;
end;
$$ language plpgsql;
-- Make seller schedule slots virtual (generated), with overrides stored in config.
-- Keeps existing tables for backward compatibility, but new code should not materialize slots.

alter table seller_schedule_configs
  add column if not exists days_ahead int,
  add column if not exists disabled_dates jsonb not null default '[]'::jsonb,
  add column if not exists disabled_slots jsonb not null default '[]'::jsonb;

-- Backfill days_ahead from legacy date_from/date_to when possible.
update seller_schedule_configs
set days_ahead = greatest(
  1,
  least(60, (date_to - date_from) + 1)
)
where days_ahead is null;

-- Remove the legacy 12-parameter overload of create_order_atomic.
-- Migration 023 added a 14-parameter version with defaults on the last two args;
-- PostgreSQL then treats calls as ambiguous between the old 12-arg and new 14-arg functions.
drop function if exists public.create_order_atomic(
  uuid,
  text,
  numeric,
  text,
  text,
  uuid,
  text,
  numeric,
  numeric,
  text,
  text,
  timestamptz,
  uuid
);
-- Structured size grade per listing (buyer-visible): small / medium / large
alter table fish_listings add column if not exists fish_size text;

alter table fish_listings drop constraint if exists fish_listings_fish_size_check;

alter table fish_listings
  add constraint fish_listings_fish_size_check
  check (fish_size is null or fish_size in ('small', 'medium', 'large'));
-- App pricing is piece|dozen only; legacy listings may still have price_unit = 'kg'.
update fish_listings
set price_unit = 'piece'
where price_unit = 'kg';
-- Listings use pricing_options jsonb only; remove legacy single price + price_unit columns.

-- Backfill from legacy columns where json is missing or empty (runs before columns are dropped).
UPDATE fish_listings
SET pricing_options = jsonb_build_array(
  jsonb_build_object(
    'id', 'default',
    'label', case coalesce(price_unit, 'piece')
      when 'dozen' then 'Per dozen'
      when 'piece' then 'Per piece'
      else 'Per piece'
    end,
    'price', greatest(coalesce(price, 0)::numeric, 1),
    'unit', case when price_unit = 'dozen' then 'dozen' else 'piece' end
  )
)
WHERE pricing_options IS NULL
   OR pricing_options = 'null'::jsonb
   OR pricing_options = '[]'::jsonb
   OR jsonb_array_length(COALESCE(pricing_options, '[]'::jsonb)) = 0;

ALTER TABLE fish_listings ALTER COLUMN pricing_options SET NOT NULL;

ALTER TABLE fish_listings DROP COLUMN IF EXISTS price;
ALTER TABLE fish_listings DROP COLUMN IF EXISTS price_unit;
-- Clarify: minimum applies to combined cart subtotal at checkout (see /api/orders/create-seller-cart)

comment on column sellers.min_order_amount is 'Minimum cart subtotal (₹) for a buyer checkout at this seller; 0 = no minimum';
-- Inventory + pre-order rules:
-- - Standard orders: deduct inventory on INSERT (status pending/scheduled).
-- - Pre-orders / payment-pending: DO NOT deduct inventory until seller confirms.
-- - On seller verify/confirm: deduct inventory once (when status transitions to confirmed).
-- - Restore inventory only if it was previously deducted.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'orders' and column_name = 'inventory_deducted'
  ) then
    alter table orders add column inventory_deducted boolean default false;
  end if;
end $$;

create or replace function decrement_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null then
    -- Pre-orders and payment-pending orders should not reserve inventory yet.
    if NEW.status in ('pre_order', 'pending_payment') then
      return NEW;
    end if;

    update fish_listings
    set weight_avail = greatest(weight_avail - NEW.quantity, 0)
    where id = NEW.listing_id;

    update orders
    set inventory_deducted = true
    where id = NEW.id;

    -- Auto-mark unavailable when stock hits 0
    update fish_listings
    set is_available = false
    where id = NEW.listing_id
      and weight_avail <= 0;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

create or replace function decrement_listing_inventory_on_confirm()
returns trigger as $$
begin
  if NEW.listing_id is not null then
    -- For pre-orders, deduct inventory only when seller confirms.
    if OLD.inventory_deducted is false
      and OLD.status in ('pre_order', 'pending_payment')
      and NEW.status = 'confirmed' then

      update fish_listings
      set weight_avail = greatest(weight_avail - NEW.quantity, 0)
      where id = NEW.listing_id;

      update orders
      set inventory_deducted = true
      where id = NEW.id;

      update fish_listings
      set is_available = false
      where id = NEW.listing_id
        and weight_avail <= 0;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

create or replace function restore_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null
    and OLD.inventory_deducted is true
    and NEW.status in ('cancelled', 'declined', 'refunded') then
    update fish_listings
    set weight_avail = weight_avail + OLD.quantity,
        is_available = true
    where id = NEW.listing_id;

    update orders
    set inventory_deducted = false
    where id = NEW.id;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_decrement_inventory on orders;
drop trigger if exists trg_restore_inventory on orders;
drop trigger if exists trg_update_inventory on orders;

create trigger trg_decrement_inventory
  after insert on orders
  for each row
  execute function decrement_listing_inventory();

create trigger trg_decrement_inventory_on_confirm
  after update on orders
  for each row
  execute function decrement_listing_inventory_on_confirm();

create trigger trg_restore_inventory
  after update on orders
  for each row
  execute function restore_listing_inventory();

-- Allow per-gram line items (pricing_options.unit = gram) to persist on orders.
alter table public.orders drop constraint if exists orders_quantity_unit_check;

alter table public.orders
  add constraint orders_quantity_unit_check
  check (quantity_unit in ('kg', 'piece', 'dozen', 'gram'));
-- Scheduled pickup orders use status = 'scheduled' (see api/orders/create.ts).
alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in (
    'pre_order', 'pending', 'confirmed', 'paid',
    'picked_up', 'completed', 'declined', 'cancelled', 'refunded', 'scheduled'
  ));
-- Retire "dozen": map legacy rows to piece; constrain to piece | kg | gram.
update public.orders
set quantity_unit = 'piece'
where quantity_unit = 'dozen';

alter table public.orders drop constraint if exists orders_quantity_unit_check;

alter table public.orders
  add constraint orders_quantity_unit_check
  check (quantity_unit in ('kg', 'piece', 'gram'));

-- Normalize pricing_options jsonb: unit "dozen" -> "piece"
update public.fish_listings fl
set pricing_options = (
  select jsonb_agg(
    case
      when (t.value->>'unit') = 'dozen' then t.value || jsonb_build_object('unit', 'piece')
      else t.value
    end
  )
  from jsonb_array_elements(fl.pricing_options) as t
)
where fl.pricing_options is not null
  and fl.pricing_options::text like '%dozen%';

update public.species_ranges
set price_unit = 'piece'
where price_unit = 'dozen';

alter table public.species_ranges drop constraint if exists species_ranges_price_unit_check;

alter table public.species_ranges
  add constraint species_ranges_price_unit_check
  check (price_unit in ('kg', 'piece', 'gram'));
-- Buyer menu: explicit flag so pickup slots hide when seller turns scheduling off,
-- even if a seller_schedule_configs row was not deleted.
alter table public.sellers
  add column if not exists schedule_pickup_slots boolean not null default false;

comment on column public.sellers.schedule_pickup_slots is
  'When true, buyers may see pickup time slots (requires seller_schedule_configs).';

update public.sellers s
set schedule_pickup_slots = true
from public.seller_schedule_configs c
where c.seller_id = s.id;
-- Retire "gram": weight is expressed only in kg (use decimals, e.g. 0.5 kg).

-- Orders: quantity was in grams → kg
update public.orders
set
  quantity = round((quantity / 1000.0)::numeric, 4),
  quantity_unit = 'kg'
where quantity_unit = 'gram';

-- Listings: stock was in grams for gram-priced listings → kg
update public.fish_listings fl
set weight_avail = round((fl.weight_avail / 1000.0)::numeric, 4)
where fl.pricing_options is not null
  and (
    fl.pricing_options::text ilike '%"unit":"gram"%'
    or fl.pricing_options::text ilike '%"unit":"g"%'
  );

-- pricing_options: gram tiers → kg (bundle_size was grams → kg)
update public.fish_listings fl
set pricing_options = (
  select coalesce(jsonb_agg(
    case
      when (t.value->>'unit') in ('gram', 'g') then
        jsonb_set(
          jsonb_set(t.value, '{unit}', '"kg"'),
          '{bundle_size}',
          to_jsonb(
            greatest(
              0.01::numeric,
              round(
                (coalesce((t.value->>'bundle_size')::numeric, 1) / 1000.0)::numeric,
                4
              )
            )
          )
        )
      else t.value
    end
  ), '[]'::jsonb)
  from jsonb_array_elements(fl.pricing_options::jsonb) as t
)
where fl.pricing_options is not null
  and (
    fl.pricing_options::text ilike '%"unit":"gram"%'
    or fl.pricing_options::text ilike '%"unit":"g"%'
  );

update public.species_ranges
set price_unit = 'kg'
where price_unit = 'gram';

alter table public.orders drop constraint if exists orders_quantity_unit_check;

alter table public.orders
  add constraint orders_quantity_unit_check
    check (quantity_unit in ('kg', 'piece'));

alter table public.species_ranges drop constraint if exists species_ranges_price_unit_check;

alter table public.species_ranges
  add constraint species_ranges_price_unit_check
    check (price_unit in ('kg', 'piece'));
-- Persistent buyer cart (cross-device, multi-seller global cart)
-- One row per (buyer_id, listing_id). Cart is grouped by seller at checkout.

create table if not exists buyer_cart (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references buyers(id) on delete cascade,
  listing_id uuid not null references fish_listings(id) on delete cascade,
  qty numeric(10, 3) not null check (qty > 0),
  qty_unit text not null default 'kg',
  price_snapshot numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_id, listing_id)
);

create index if not exists idx_buyer_cart_buyer on buyer_cart(buyer_id);
create index if not exists idx_buyer_cart_listing on buyer_cart(listing_id);

comment on table buyer_cart is 'Persistent cross-device cart for buyers. API uses service role; one order per seller at checkout.';
-- Soft-delete column for fish_listings so seller "Delete" doesn't break order FKs.
-- Buyer + seller dashboard queries should `.is("deleted_at", null)` to hide deleted rows.

alter table fish_listings
  add column if not exists deleted_at timestamptz;

create index if not exists idx_fish_listings_deleted_at on fish_listings(deleted_at);

comment on column fish_listings.deleted_at is 'Set when seller deletes a listing; existing orders keep the FK pointer.';
-- Pre-order buyer preferences: cut style + special request notes.

alter table orders
  add column if not exists buyer_notes text default '',
  add column if not exists cut_style text default '';

comment on column orders.buyer_notes is 'Free-text special request from buyer (e.g. "medium size pieces, no head")';
comment on column orders.cut_style is 'Cut preference: whole, cleaned, or cut';
-- Enable Supabase Realtime on orders table for live buyer-seller order flow
alter publication supabase_realtime add table orders;
-- Add ready_for_pickup to allowed order statuses
alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in (
    'pre_order', 'pending', 'confirmed', 'paid', 'ready_for_pickup',
    'picked_up', 'completed', 'declined', 'cancelled', 'refunded', 'scheduled'
  ));
-- Add out_for_delivery to allowed order statuses
alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in (
    'pre_order', 'pending', 'confirmed', 'paid', 'ready_for_pickup',
    'out_for_delivery', 'picked_up', 'completed',
    'declined', 'cancelled', 'refunded', 'scheduled'
  ));
-- Email verification flag for buyers and sellers
alter table sellers add column if not exists email_verified boolean not null default false;
alter table buyers add column if not exists email_verified boolean not null default false;

-- Reset verified when email changes (trigger)
create or replace function reset_email_verified() returns trigger as $$
begin
  if OLD.email is distinct from NEW.email then
    NEW.email_verified = false;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_sellers_reset_email_verified on sellers;
create trigger trg_sellers_reset_email_verified
  before update on sellers for each row execute function reset_email_verified();

drop trigger if exists trg_buyers_reset_email_verified on buyers;
create trigger trg_buyers_reset_email_verified
  before update on buyers for each row execute function reset_email_verified();
-- Payment screenshot upload + seller verification
-- Buyers upload proof of UPI/bank transfer; sellers verify from dashboard.

alter table orders
  add column if not exists payment_screenshot_urls text[] not null default '{}',
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by uuid references sellers(id);
-- NULL payment_verified_by = system auto-verified (price-match path)

comment on column orders.payment_screenshot_urls is 'Array of Supabase Storage URLs: order-payments/{order_id}/{filename}. Multiple files supported for partial UPI payments.';
comment on column orders.payment_verified_at is 'When seller (or system) confirmed payment';
comment on column orders.payment_verified_by is 'Seller who verified. NULL = system auto-verified on price match.';

-- Add pending_payment status so orders with no screenshot yet are distinguishable from pending orders
-- REQUIRED: verify all existing status values before running this
-- Run first: SELECT DISTINCT status FROM orders;
do $$ begin
  alter table orders drop constraint if exists orders_status_check;
  alter table orders add constraint orders_status_check
    check (status in (
      'pre_order', 'pending', 'pending_payment', 'confirmed', 'paid', 'payment_required',
      'scheduled', 'out_for_delivery', 'ready_for_pickup',
      'picked_up', 'completed', 'declined', 'cancelled', 'refunded'
    ));
exception when others then
  raise notice 'Status constraint update failed: %. Run SELECT DISTINCT status FROM orders first.', sqlerrm;
end $$;
-- Pre-order independence: listings can accept pre-orders regardless of inventory.
-- Removes the weight_avail=0 gate — pre-order visibility is now controlled per-listing.

alter table fish_listings
  add column if not exists is_preorder_enabled boolean not null default false,
  add column if not exists preorder_min_qty numeric(10,2) not null default 1,
  add column if not exists preorder_max_qty numeric(10,2); -- NULL = uncapped

comment on column fish_listings.is_preorder_enabled is 'Seller enables pre-orders for this listing independently of stock level';
comment on column fish_listings.preorder_min_qty is 'Minimum quantity buyer must pre-order';
comment on column fish_listings.preorder_max_qty is 'Maximum quantity per pre-order. NULL = no cap.';

-- Per-day schedule for seller: which days open for normal orders + pre-orders
alter table sellers
  add column if not exists open_days text[] not null default array['mon','tue','wed','thu','fri','sat','sun'],
  add column if not exists preorder_days text[] not null default array[]::text[],
  add column if not exists preorder_cutoff_time time not null default '22:00';

comment on column sellers.open_days is 'Days seller is open for normal same-day orders. Values: mon tue wed thu fri sat sun';
comment on column sellers.preorder_days is 'Days seller accepts pre-orders (next-day catch). Empty = no pre-orders.';
comment on column sellers.preorder_cutoff_time is 'Latest time buyer can place a pre-order for next day. Default 22:00.';
-- Pre-order price reconciliation.
-- Seller sets final_price after catch; system auto-compares to paid_amount.
-- Overpaid → refund. Match → confirm. Underpaid → payment_required.

alter table orders
  add column if not exists final_price numeric(10,2);

comment on column orders.final_price is 'Actual price set by seller after catch. Compared to paid_amount for reconciliation.';
comment on column orders.paid_amount is 'Amount buyer paid at pre-order time (listing.price × qty). Set at order creation.';

-- Reconciliation function: triggered when seller sets final_price on a pre_order.
-- Returns the new status so the API can notify both parties.
create or replace function reconcile_preorder_price(
  p_order_id uuid,
  p_final_price numeric
) returns text as $$
declare
  v_paid numeric;
  v_new_status text;
begin
  select paid_amount into v_paid from orders where id = p_order_id;
  if v_paid is null then
    raise exception 'Order % has no paid_amount — not a pre-order', p_order_id;
  end if;

  if p_final_price = v_paid then
    v_new_status := 'confirmed';
  elsif p_final_price < v_paid then
    v_new_status := 'refunded';   -- seller owes buyer the difference
  else
    v_new_status := 'payment_required'; -- buyer short-paid
  end if;

  update orders
    set final_price = p_final_price,
        status = v_new_status,
        updated_at = now()
  where id = p_order_id;

  return v_new_status;
end;
$$ language plpgsql security definer;

comment on function reconcile_preorder_price is
  'Sets final_price on a pre-order and returns new status: confirmed | refunded | payment_required. Call from /api/seller/orders action=set_final_price.';
-- Refund tracking: seller marks when UPI refund was sent to buyer
alter table orders
  add column if not exists refund_note text,
  add column if not exists refund_sent_at timestamptz;

comment on column orders.refund_note is 'Seller note when marking refund as sent (e.g. UTR number or message)';
comment on column orders.refund_sent_at is 'Timestamp when seller marked refund as sent to buyer';
-- Seller can upload proof of UPI refund transfer
alter table orders
  add column if not exists refund_screenshot_path text;

comment on column orders.refund_screenshot_path is 'Storage path of seller-uploaded refund proof screenshot (order-payments bucket)';
-- Pre-order price range: seller declares estimated min/max price for next-day catch.
-- Buyers see this range upfront so they know what to expect before paying.
-- Seller sets the actual final_price after the catch via reconcile_preorder_price.

alter table fish_listings
  add column if not exists preorder_price_min numeric(10,2),
  add column if not exists preorder_price_max numeric(10,2);

comment on column fish_listings.preorder_price_min is 'Estimated minimum price seller will charge for this pre-order listing';
comment on column fish_listings.preorder_price_max is 'Estimated maximum price seller will charge for this pre-order listing';
-- Buyer rating + feedback for delivered/completed orders

create table if not exists order_feedback (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  buyer_id uuid not null references buyers(id) on delete cascade,
  seller_id uuid not null references sellers(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  feedback text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, buyer_id)
);

create index if not exists idx_order_feedback_seller_id on order_feedback(seller_id);
create index if not exists idx_order_feedback_order_id on order_feedback(order_id);

alter table order_feedback enable row level security;

drop policy if exists "Anyone can view order feedback" on order_feedback;
create policy "Anyone can view order feedback"
  on order_feedback for select using (true);

-- Ensure payment screenshot storage bucket exists.
-- Used by buyer payment proof uploads and seller refund proof uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-payments',
  'order-payments',
  false,
  5242880,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Pay-first: do not decrement listing stock inside create_order_atomic when the order
-- starts as pending_payment or pre_order. Inventory is deducted on seller confirm
-- (see decrement_listing_inventory_on_confirm in migration 029).

create or replace function public.create_order_atomic(
  p_listing_id uuid,
  p_species text,
  p_quantity numeric,
  p_quantity_unit text,
  p_buyer_phone text,
  p_buyer_id uuid,
  p_buyer_addr text,
  p_total_price numeric,
  p_delivery_fee numeric,
  p_status text,
  p_order_type text,
  p_scheduled_for timestamptz,
  p_schedule_slot_id uuid,
  p_pricing_option_id text default null,
  p_pricing_label text default null
) returns uuid as $$
declare
  v_order_id uuid;
  v_avail numeric;
begin
  if p_listing_id is not null then
    select weight_avail into v_avail
    from fish_listings
    where id = p_listing_id
    for update;

    if v_avail is null then
      raise exception 'Listing not found';
    end if;

    if v_avail < p_quantity then
      raise exception 'Only % % in stock', v_avail, p_quantity_unit;
    end if;

    if p_status is distinct from 'pending_payment' and p_status is distinct from 'pre_order' then
      update fish_listings
      set weight_avail = weight_avail - p_quantity
      where id = p_listing_id;
    end if;
  end if;

  insert into orders (
    listing_id, species, quantity, quantity_unit, buyer_phone, buyer_id,
    buyer_addr, total_price, delivery_fee, platform_fee, status, order_type,
    payment_type, paid_amount, scheduled_for, schedule_slot_id,
    pricing_option_id, pricing_label
  ) values (
    p_listing_id, p_species, p_quantity, p_quantity_unit, p_buyer_phone, p_buyer_id,
    p_buyer_addr, p_total_price, p_delivery_fee, 0, p_status, p_order_type,
    'cod', case when p_status in ('pre_order', 'pending_payment') then p_total_price + p_delivery_fee else null end,
    p_scheduled_for, p_schedule_slot_id,
    p_pricing_option_id, p_pricing_label
  ) returning id into v_order_id;

  return v_order_id;
end;
$$ language plpgsql;
-- Persist how the order was placed: same-day (open hours) vs pre-order (closed + preorder window).
alter table orders
  add column if not exists placement_kind text
  check (placement_kind is null or placement_kind in ('same_day', 'preorder'));

comment on column orders.placement_kind is
  'same_day = placed while seller open; preorder = placed in pre-order shopping window (timing only).';
-- Migrate pre-order price range from global listing columns to per-unit pricing_options JSONB.
-- Drop unused preorder_min_qty / preorder_max_qty (spec: pre-orders have no quantity limit).
-- Add is_order_paused: lets seller pause a listing for same-day orders while keeping pre-order menu.

-- Step 1: Copy existing global preorder_price_min/max into pricing_options[0] of each listing
UPDATE fish_listings
SET pricing_options = (
  SELECT jsonb_agg(
    CASE WHEN pos = 0 THEN
      opt
      || jsonb_build_object('preorder_price_min', fish_listings.preorder_price_min)
      || jsonb_build_object('preorder_price_max', fish_listings.preorder_price_max)
    ELSE opt
    END
  )
  FROM jsonb_array_elements(fish_listings.pricing_options) WITH ORDINALITY AS t(opt, pos)
)
WHERE pricing_options IS NOT NULL
  AND jsonb_array_length(pricing_options) > 0
  AND (preorder_price_min IS NOT NULL OR preorder_price_max IS NOT NULL);

-- Step 2: Drop old global columns
ALTER TABLE fish_listings
  DROP COLUMN IF EXISTS preorder_price_min,
  DROP COLUMN IF EXISTS preorder_price_max,
  DROP COLUMN IF EXISTS preorder_min_qty,
  DROP COLUMN IF EXISTS preorder_max_qty;

-- Step 3: Add is_order_paused flag
ALTER TABLE fish_listings
  ADD COLUMN IF NOT EXISTS is_order_paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fish_listings.is_order_paused IS
  'When true, listing is hidden from same-day order menu but still visible in pre-order menu when is_preorder_enabled=true';
-- OTP codes table: self-managed OTP with rate limits
-- Replaces the scattered otp_attempts logic; works with MSG91 or any SMS provider.
create table if not exists otp_codes (
  phone           text primary key,
  code            text not null,                          -- 6-digit OTP (plain, server-key-only readable)
  expires_at      timestamptz not null,                   -- code expires after 10 minutes
  verify_attempts int not null default 0,                 -- wrong guesses for current code (max 3)
  sends_today     int not null default 0,                 -- SMS sends today (max 3, resets at IST midnight)
  send_date       date not null default current_date,     -- IST date of last send
  last_sent_at    timestamptz not null default now(),     -- for 30-second cooldown
  created_at      timestamptz not null default now()
);

-- Only service-role can read/write (RLS off for service key, on for anon)
alter table otp_codes enable row level security;
-- No public access — API routes use service key only
create policy "service_only" on otp_codes for all using (false);
-- Add 'jumbo' as valid fish_size grade (e.g. jumbo prawns)
alter table fish_listings drop constraint if exists fish_listings_fish_size_check;

alter table fish_listings
  add constraint fish_listings_fish_size_check
  check (fish_size is null or fish_size in ('small', 'medium', 'large', 'jumbo'));
-- Group orders from the same cart checkout together.
-- Existing rows get NULL — rendered as individual cards, no backfill needed.
alter table orders
  add column if not exists checkout_session_id uuid;

create index if not exists orders_checkout_session_idx
  on orders (checkout_session_id)
  where checkout_session_id is not null;
-- Rollback: remove checkout_session_id column and index added in the previous 054/055 migrations.
drop index if exists orders_checkout_session_idx;

alter table orders
  drop column if exists checkout_session_id;

-- Restore create_order_atomic to the version from migration 050 (no checkout_session_id param).
create or replace function public.create_order_atomic(
  p_listing_id uuid,
  p_species text,
  p_quantity numeric,
  p_quantity_unit text,
  p_buyer_phone text,
  p_buyer_id uuid,
  p_buyer_addr text,
  p_total_price numeric,
  p_delivery_fee numeric,
  p_status text,
  p_order_type text,
  p_scheduled_for timestamptz,
  p_schedule_slot_id uuid,
  p_pricing_option_id text default null,
  p_pricing_label text default null
) returns uuid as $$
declare
  v_order_id uuid;
  v_avail numeric;
begin
  if p_listing_id is not null then
    select weight_avail into v_avail
    from fish_listings
    where id = p_listing_id
    for update;

    if v_avail is null then
      raise exception 'Listing not found';
    end if;

    if v_avail < p_quantity then
      raise exception 'Only % % in stock', v_avail, p_quantity_unit;
    end if;

    if p_status is distinct from 'pending_payment' and p_status is distinct from 'pre_order' then
      update fish_listings
      set weight_avail = weight_avail - p_quantity
      where id = p_listing_id;
    end if;
  end if;

  insert into orders (
    listing_id, species, quantity, quantity_unit, buyer_phone, buyer_id,
    buyer_addr, total_price, delivery_fee, platform_fee, status, order_type,
    payment_type, paid_amount, scheduled_for, schedule_slot_id,
    pricing_option_id, pricing_label
  ) values (
    p_listing_id, p_species, p_quantity, p_quantity_unit, p_buyer_phone, p_buyer_id,
    p_buyer_addr, p_total_price, p_delivery_fee, 0, p_status, p_order_type,
    'cod', case when p_status in ('pre_order', 'pending_payment') then p_total_price + p_delivery_fee else null end,
    p_scheduled_for, p_schedule_slot_id,
    p_pricing_option_id, p_pricing_label
  ) returning id into v_order_id;

  return v_order_id;
end;
$$ language plpgsql;
-- Add p_checkout_session_id param to create_order_atomic.
-- Default null = backwards compatible with any existing callers.
create or replace function public.create_order_atomic(
  p_listing_id uuid,
  p_species text,
  p_quantity numeric,
  p_quantity_unit text,
  p_buyer_phone text,
  p_buyer_id uuid,
  p_buyer_addr text,
  p_total_price numeric,
  p_delivery_fee numeric,
  p_status text,
  p_order_type text,
  p_scheduled_for timestamptz,
  p_schedule_slot_id uuid,
  p_pricing_option_id text default null,
  p_pricing_label text default null,
  p_checkout_session_id uuid default null
) returns uuid as $$
declare
  v_order_id uuid;
  v_avail numeric;
begin
  if p_listing_id is not null then
    select weight_avail into v_avail
    from fish_listings
    where id = p_listing_id
    for update;

    if v_avail is null then
      raise exception 'Listing not found';
    end if;

    if v_avail < p_quantity then
      raise exception 'Only % % in stock', v_avail, p_quantity_unit;
    end if;

    if p_status is distinct from 'pending_payment' and p_status is distinct from 'pre_order' then
      update fish_listings
      set weight_avail = weight_avail - p_quantity
      where id = p_listing_id;
    end if;
  end if;

  insert into orders (
    listing_id, species, quantity, quantity_unit, buyer_phone, buyer_id,
    buyer_addr, total_price, delivery_fee, platform_fee, status, order_type,
    payment_type, paid_amount, scheduled_for, schedule_slot_id,
    pricing_option_id, pricing_label, checkout_session_id
  ) values (
    p_listing_id, p_species, p_quantity, p_quantity_unit, p_buyer_phone, p_buyer_id,
    p_buyer_addr, p_total_price, p_delivery_fee, 0, p_status, p_order_type,
    'cod',
    case when p_status in ('pre_order', 'pending_payment')
         then p_total_price + p_delivery_fee else null end,
    p_scheduled_for, p_schedule_slot_id,
    p_pricing_option_id, p_pricing_label,
    p_checkout_session_id
  ) returning id into v_order_id;

  return v_order_id;
end;
$$ language plpgsql;
-- Add Razorpay payment columns to orders table.
-- These are required by the razorpay-create-order and razorpay-verify API endpoints.

alter table orders
  add column if not exists razorpay_order_id text,
  add column if not exists razorpay_payment_id text,
  add column if not exists payment_method text;

comment on column orders.razorpay_order_id is 'Razorpay order ID (rzp_order_*) stored after razorpay-create-order call. Used for idempotency and replay-attack prevention.';
comment on column orders.razorpay_payment_id is 'Razorpay payment ID (pay_*) stored after successful razorpay-verify call.';
comment on column orders.payment_method is 'Payment method used: "razorpay" for online payments, NULL for manual UPI/bank-transfer screenshot flow.';
-- Add is_preorder boolean to orders table.
-- TRUE  = order placed while seller was closed (pre-order window, before cutoff).
-- FALSE = order placed while seller was open (same-day order).
-- NULL  = legacy orders created before this column existed (treat as same-day).

alter table orders
  add column if not exists is_preorder boolean default false;

comment on column orders.is_preorder is 'TRUE if order was placed during pre-order window (seller closed, before cutoff). FALSE or NULL = same-day order placed while seller was open.';
-- Extend delivery fee: support per-km pricing in addition to flat fee

alter table sellers add column if not exists delivery_fee_type text not null default 'fixed'
  check (delivery_fee_type in ('fixed', 'per_km'));

alter table sellers add column if not exists delivery_fee_per_km numeric(10, 2) not null default 0;

comment on column sellers.delivery_fee_type is 'fixed = flat fee amount; per_km = fee computed as distance × delivery_fee_per_km';
comment on column sellers.delivery_fee_per_km is 'Per-km rate (₹/km) used when delivery_fee_type = per_km';

-- 059_sync_supabase_schemas.sql
-- Idempotent schema sync between Staging and Production databases.

-- 1. Table: fish_listings
-- Drop obsolete 'expires_at' column (removed in Staging per migration 011, but lingering in Prod)
alter table public.fish_listings 
  drop column if exists expires_at;

-- 2. Table: orders
-- Add required 'inventory_deducted' column (present in Staging but missing in Prod)
alter table public.orders 
  add column if not exists inventory_deducted boolean default false;

-- Drop obsolete 'seller_upi_id' column (lingering in Prod, not referenced in codebase)
alter table public.orders 
  drop column if exists seller_upi_id;

-- 3. Table: sellers
-- Add required 'upi_id' column (present in Prod but missing in Staging)
alter table public.sellers 
  add column if not exists upi_id text;

-- Add required 'store_image_url' column (present in Prod but missing in Staging)
alter table public.sellers 
  add column if not exists store_image_url text;

-- Add required 'has_pickup' column (present in Prod but missing in Staging)
alter table public.sellers 
  add column if not exists has_pickup boolean default true;
