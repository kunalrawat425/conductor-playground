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
