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
