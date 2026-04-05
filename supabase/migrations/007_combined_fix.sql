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
