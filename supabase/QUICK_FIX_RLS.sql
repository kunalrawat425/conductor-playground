-- QUICK FIX: Paste this into Supabase SQL Editor → Run
-- Fixes the infinite recursion on sellers table

-- Step 1: Create is_admin() that bypasses RLS
create or replace function is_admin()
returns boolean as $$
  select coalesce(
    (select is_admin from sellers where auth_id = auth.uid()),
    false
  )
$$ language sql security definer;

-- Step 2: Drop the recursive policy
drop policy if exists "Admins can do anything with sellers" on sellers;

-- Step 3: Recreate clean policies
drop policy if exists "Anyone can view seller profiles" on sellers;
create policy "Anyone can view seller profiles"
  on sellers for select using (true);

drop policy if exists "Sellers can update own profile" on sellers;
create policy "Sellers can update own profile"
  on sellers for update using (auth_id = auth.uid());

drop policy if exists "Admins can insert sellers" on sellers;
create policy "Admins can insert sellers"
  on sellers for insert with check (is_admin());

drop policy if exists "Admins can delete sellers" on sellers;
create policy "Admins can delete sellers"
  on sellers for delete using (is_admin());

-- Step 4: Fix other tables that had the same issue
drop policy if exists "Admins can manage species ranges" on species_ranges;
create policy "Admins can manage species ranges"
  on species_ranges for all using (is_admin());

drop policy if exists "Admins can insert price logs" on price_logs;
create policy "Admins can insert price logs"
  on price_logs for insert with check (is_admin());

drop policy if exists "Sellers can update their orders" on orders;
drop policy if exists "Sellers can update orders for their listings" on orders;
create policy "Sellers can update orders for their listings"
  on orders for update using (
    listing_id in (select id from fish_listings where seller_id = get_seller_id())
    or is_admin()
  );

-- Step 5: Add missing columns
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'opens_at') then
    alter table sellers add column opens_at time default '05:00';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'closes_at') then
    alter table sellers add column closes_at time default '14:00';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'push_subscription') then
    alter table sellers add column push_subscription jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'push_enabled') then
    alter table sellers add column push_enabled boolean default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'sellers' and column_name = 'accepts_preorder') then
    alter table sellers add column accepts_preorder boolean default true;
  end if;
end $$;

-- Step 6: Inventory triggers
create or replace function decrement_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null then
    update fish_listings
    set weight_avail = greatest(weight_avail - NEW.quantity, 0)
    where id = NEW.listing_id;
    update fish_listings
    set is_available = false
    where id = NEW.listing_id and weight_avail <= 0;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_decrement_inventory on orders;
create trigger trg_decrement_inventory
  after insert on orders
  for each row
  execute function decrement_listing_inventory();

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

drop trigger if exists trg_restore_inventory on orders;
create trigger trg_restore_inventory
  after update on orders
  for each row
  execute function restore_listing_inventory();

-- Ensure listings are visible (availability-only model)
update fish_listings
  set is_available = true
  where is_available = true;
