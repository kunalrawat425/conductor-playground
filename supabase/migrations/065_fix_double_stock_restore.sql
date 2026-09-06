-- BUG-38: every cancellation/decline/refund restored stock TWICE, inventing
-- phantom inventory equal to the order quantity.
--
-- Cause: restore_listing_inventory() is an AFTER UPDATE trigger whose own body
-- runs `update orders set inventory_deducted = false where id = NEW.id`. That
-- nested UPDATE re-fires the same trigger, and at that point OLD.inventory_deducted
-- is still true and NEW.status is still 'cancelled', so the guard passes again
-- and the quantity is added a second time. A third firing stops because
-- OLD.inventory_deducted has finally become false.
--
-- Measured on staging before this migration (2 kg order, listing at 27.5):
--   insert (deduct)      -> 25.5
--   status -> cancelled  -> 29.5     i.e. +4 restored for a 2 kg order
--
-- Fix: only fire the restore when the STATUS actually changed. The nested
-- bookkeeping UPDATE leaves status untouched, so it no longer re-triggers.
-- decrement_listing_inventory_on_confirm() does not need this because its guard
-- already tests OLD.status, which no longer matches on the nested update.

drop trigger if exists trg_restore_inventory on orders;

create trigger trg_restore_inventory
  after update on orders
  for each row
  when (OLD.status is distinct from NEW.status)
  execute function restore_listing_inventory();

-- Defence in depth: even if something re-fires this with an unchanged status,
-- refuse to restore for an order that was already in a terminal state.
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

    -- Only re-list if there is genuinely stock again. The previous version
    -- force-set is_available = true unconditionally, which re-listed items a
    -- seller had deliberately marked sold out.
    update fish_listings
    set is_available = true
    where id = NEW.listing_id
      and weight_avail > 0;

    update orders
    set inventory_deducted = false
    where id = NEW.id;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;
