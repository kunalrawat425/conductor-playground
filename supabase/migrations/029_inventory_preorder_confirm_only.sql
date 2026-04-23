-- Inventory + pre-order rules:
-- - Standard orders: deduct inventory on INSERT (status pending/scheduled).
-- - Pre-orders / payment-pending: DO NOT deduct inventory until seller confirms.
-- - On seller verify/confirm: deduct inventory once (when status transitions to confirmed).
-- - Restore inventory only if it was previously deducted.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'orders' and column_name = 'inventory_deducted'
  ) then
    alter table orders add column inventory_deducted boolean default false;
  end if;
end $$;

create or replace function decrement_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null then
    -- Pre-orders and payment-pending orders should not reserve inventory yet.
    if NEW.status in ('pre_order', 'pending_payment') then
      return NEW;
    end if;

    update fish_listings
    set weight_avail = greatest(weight_avail - NEW.quantity, 0)
    where id = NEW.listing_id;

    update orders
    set inventory_deducted = true
    where id = NEW.id;

    -- Auto-mark unavailable when stock hits 0
    update fish_listings
    set is_available = false
    where id = NEW.listing_id
      and weight_avail <= 0;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

create or replace function decrement_listing_inventory_on_confirm()
returns trigger as $$
begin
  if NEW.listing_id is not null then
    -- For pre-orders, deduct inventory only when seller confirms.
    if OLD.inventory_deducted is false
      and OLD.status in ('pre_order', 'pending_payment')
      and NEW.status = 'confirmed' then

      update fish_listings
      set weight_avail = greatest(weight_avail - NEW.quantity, 0)
      where id = NEW.listing_id;

      update orders
      set inventory_deducted = true
      where id = NEW.id;

      update fish_listings
      set is_available = false
      where id = NEW.listing_id
        and weight_avail <= 0;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

create or replace function restore_listing_inventory()
returns trigger as $$
begin
  if NEW.listing_id is not null
    and OLD.inventory_deducted is true
    and NEW.status in ('cancelled', 'declined', 'refunded') then
    update fish_listings
    set weight_avail = weight_avail + OLD.quantity,
        is_available = true
    where id = NEW.listing_id;

    update orders
    set inventory_deducted = false
    where id = NEW.id;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_decrement_inventory on orders;
drop trigger if exists trg_restore_inventory on orders;
drop trigger if exists trg_update_inventory on orders;

create trigger trg_decrement_inventory
  after insert on orders
  for each row
  execute function decrement_listing_inventory();

create trigger trg_decrement_inventory_on_confirm
  after update on orders
  for each row
  execute function decrement_listing_inventory_on_confirm();

create trigger trg_restore_inventory
  after update on orders
  for each row
  execute function restore_listing_inventory();

