-- Align production's inventory triggers with staging (migration 029 + BUG-38).
--
-- Measured divergence before this migration:
--
--                          insert pending | insert pending_payment | ->confirmed | ->cancelled
--   PROD                   -2, flag false | -2  (should be 0)      | no deduct   | +0  LEAK
--   STAGING (correct)      -2, flag true  |  0                     | -2          | +2
--
-- Production deducts on EVERY insert, never records that it did, and never
-- gives the stock back — so every cancelled or abandoned order permanently eats
-- inventory. Sellers silently drift toward showing less stock than they have.
--
-- Safe to run on a database that already has 029: every statement is
-- create-or-replace / if-not-exists, and the definitions below are what staging
-- already runs.
--
-- ROLLBACK is at the bottom of this file.

-- 1. Tracking column (already present on both; harmless if it exists).
alter table orders add column if not exists inventory_deducted boolean default false;

-- 2. Deduct on INSERT, but not for orders that have not been paid for yet.
create or replace function decrement_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null then
    -- Pre-orders and payment-pending orders must not reserve inventory yet.
    if NEW.status in ('pre_order', 'pending_payment') then
      return NEW;
    end if;

    update fish_listings
    set weight_avail = greatest(weight_avail - NEW.quantity, 0)
    where id = NEW.listing_id;

    update orders set inventory_deducted = true where id = NEW.id;

    update fish_listings
    set is_available = false
    where id = NEW.listing_id and weight_avail <= 0;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- 3. Deduct when a pre-order / payment-pending order becomes confirmed.
create or replace function decrement_listing_inventory_on_confirm()
returns trigger as $$
begin
  if NEW.listing_id is not null
    and OLD.inventory_deducted is false
    and OLD.status in ('pre_order', 'pending_payment')
    and NEW.status = 'confirmed' then

    update fish_listings
    set weight_avail = greatest(weight_avail - NEW.quantity, 0)
    where id = NEW.listing_id;

    update orders set inventory_deducted = true where id = NEW.id;

    update fish_listings
    set is_available = false
    where id = NEW.listing_id and weight_avail <= 0;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- 4. Restore on a terminal status — exactly once (BUG-38).
create or replace function restore_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null
    and OLD.inventory_deducted is true
    and NEW.status in ('cancelled', 'declined', 'refunded')
    and OLD.status not in ('cancelled', 'declined', 'refunded') then

    update fish_listings
    set weight_avail = weight_avail + OLD.quantity
    where id = NEW.listing_id;

    -- Only re-list when there is genuinely stock again; the pre-BUG-38 version
    -- force-set is_available = true and re-listed sold-out items.
    update fish_listings
    set is_available = true
    where id = NEW.listing_id and weight_avail > 0;

    update orders set inventory_deducted = false where id = NEW.id;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- 5. Triggers. The WHEN clauses are what stop each function's own bookkeeping
--    UPDATE from re-firing it (that self-retrigger was BUG-38's double restore).
drop trigger if exists trg_decrement_inventory on orders;
create trigger trg_decrement_inventory
  after insert on orders
  for each row
  execute function decrement_listing_inventory();

drop trigger if exists trg_decrement_inventory_on_confirm on orders;
create trigger trg_decrement_inventory_on_confirm
  after update on orders
  for each row
  when (OLD.status is distinct from NEW.status)
  execute function decrement_listing_inventory_on_confirm();

drop trigger if exists trg_restore_inventory on orders;
create trigger trg_restore_inventory
  after update on orders
  for each row
  when (OLD.status is distinct from NEW.status)
  execute function restore_listing_inventory();

-- 6. NO BACKFILL HERE — it is production-only and lives in 068.
--    On staging, pending_payment orders correctly have NO stock deducted, so
--    marking them `inventory_deducted = true` would make a later cancellation
--    hand back stock that was never taken. The backfill is only correct on a
--    database that used the OLD deduct-on-every-insert behaviour.

-- ---------------------------------------------------------------------------
-- ROLLBACK (returns a database to the pre-migration production behaviour):
--
--   drop trigger if exists trg_restore_inventory on orders;
--   drop trigger if exists trg_decrement_inventory_on_confirm on orders;
--
--   create or replace function decrement_listing_inventory()
--   returns trigger as $$
--   begin
--     if NEW.listing_id is not null then
--       update fish_listings
--       set weight_avail = greatest(weight_avail - NEW.quantity, 0)
--       where id = NEW.listing_id;
--       update fish_listings
--       set is_available = false
--       where id = NEW.listing_id and weight_avail <= 0;
--     end if;
--     return NEW;
--   end;
--   $$ language plpgsql security definer;
-- ---------------------------------------------------------------------------
