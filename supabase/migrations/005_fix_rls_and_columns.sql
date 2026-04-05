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

-- 7. Refresh seed listing expiry (so they show up)
update fish_listings
  set expires_at = now() + interval '12 hours',
      is_available = true
  where is_available = true;

-- ============================================
-- DONE! This fixes:
--   ✅ sellers.opens_at / closes_at columns
--   ✅ sellers.push_subscription / push_enabled columns
--   ✅ species_ranges RLS infinite recursion
--   ✅ Listing expiry refreshed to 12 hours
-- ============================================
