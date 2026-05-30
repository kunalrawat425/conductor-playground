-- 059_sync_supabase_schemas.sql
-- Idempotent schema sync and data backfill between Staging and Production databases.

-- ==========================================
-- 1. ADD COLUMNS (idempotent, safe)
-- ==========================================

-- Table: orders
alter table public.orders 
  add column if not exists inventory_deducted boolean default false;

-- Table: sellers
alter table public.sellers 
  add column if not exists upi_id text,
  add column if not exists store_image_url text,
  add column if not exists has_pickup boolean default true;

-- ==========================================
-- 2. DATA MIGRATION & BACKFILL
-- ==========================================

-- Step A: Migrate legacy UPI ID from orders.seller_upi_id (Prod) to sellers.upi_id (Staging/Prod)
-- Only run if sellers.upi_id is null and orders.seller_upi_id has a value.
update public.sellers s
set upi_id = o.seller_upi_id
from public.orders o
join public.fish_listings fl on o.listing_id = fl.id
where fl.seller_id = s.id
  and o.seller_upi_id is not null
  and s.upi_id is null;

-- Step B: Backfill 'inventory_deducted' status for existing active/completed orders on Production
-- Any order that is confirmed, paid, completed, out_for_delivery, ready_for_pickup, picked_up, or scheduled
-- should have inventory_deducted set to true to prevent future stock cancellation anomalies.
update public.orders
set inventory_deducted = true
where status in ('confirmed', 'paid', 'ready_for_pickup', 'out_for_delivery', 'picked_up', 'completed', 'scheduled')
  and (inventory_deducted is null or inventory_deducted is false);

-- Step C: Ensure existing sellers have has_pickup set to true (default is true, but existing rows might be null)
update public.sellers
set has_pickup = true
where has_pickup is null;

-- ==========================================
-- 3. DROP OBSOLETE COLUMNS
-- ==========================================

-- Table: fish_listings
alter table public.fish_listings 
  drop column if exists expires_at;

-- Table: orders
alter table public.orders 
  drop column if exists seller_upi_id;
