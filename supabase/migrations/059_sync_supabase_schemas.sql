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
