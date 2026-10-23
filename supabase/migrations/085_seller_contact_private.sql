-- 085: the public (anon) key could read every seller's phone, email, UPI id, push
-- subscription and login id ("Anyone can view seller profiles" = SELECT true on all columns).
-- Public pages keep reading the storefront columns; contact and login columns are
-- server-only (service role). Keep this list in sync with SELLER_PUBLIC_COLUMNS in
-- src/lib/supabase.ts: a new sellers column is NOT readable by the public key until granted.

revoke select on public.sellers from anon, authenticated;
grant select (
  id, name, location, location_name, lat, lng, rating_avg, rating_count, total_orders, created_at, is_active, is_test,
  has_delivery, has_pickup, delivery_rad, min_order_amount, low_stock_threshold, push_enabled, email_verified,
  delivery_fee_enabled, delivery_fee_amount, delivery_fee_type, delivery_fee_per_km, free_delivery_above,
  opens_at, closes_at, open_days, accepts_preorder, preorder_days, preorder_cutoff_time, preorder_opens_at, delivery_days,
  schedule_pickup_slots, delivery_slots_enabled, delivery_slot_minutes, preorder_delivery_start, preorder_delivery_end,
  preorder_days_ahead, store_image_url, logo_url
) on public.sellers to anon, authenticated;

-- These policies read sellers.auth_id / is_admin as the caller, which now fails for the
-- public key. is_admin() is SECURITY DEFINER and does the same check.
drop policy if exists "Admins can view all buyers" on public.buyers;
create policy "Admins can view all buyers" on public.buyers for select using (is_admin());

drop policy if exists "Sellers can update orders for their listings" on public.orders;
create policy "Sellers can update orders for their listings" on public.orders for update using (
  listing_id in (select fish_listings.id from fish_listings where fish_listings.seller_id = get_seller_id())
  or is_admin()
);
