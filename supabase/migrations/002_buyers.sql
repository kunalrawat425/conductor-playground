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
