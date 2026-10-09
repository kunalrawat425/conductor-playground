-- 071: test-data convention, cart price tiers, order address copy, inventory
--      bookkeeping, and the cheap security fixes that need no app change.
-- Found auditing prod 2026-10-08 (docs/SYSTEM-AUDIT.md §3, §8). Safe on staging
-- and prod. Idempotent. The app code shipped with it tolerates this migration
-- not being applied yet (falls back where a new column is missing).

------------------------------------------------------------------------------
-- 1. Test-data convention
--    Mark test sellers/buyers is_test (+ "TEST " name prefix for humans).
--    Every order of a test seller or test buyer is is_test automatically.
--    Test sellers stay is_active=false: hidden from every public list, but the
--    order path accepts them (resolve-listing-order-line.ts) for QA by link.
--    Cleanup any time:  select public.purge_test_orders();
------------------------------------------------------------------------------
alter table public.sellers add column if not exists is_test boolean not null default false;
alter table public.buyers  add column if not exists is_test boolean not null default false;
alter table public.orders  add column if not exists is_test boolean not null default false;
create index if not exists idx_orders_is_test on public.orders(is_test) where is_test;

create or replace function public.orders_inherit_is_test()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_test := coalesce(new.is_test, false)
    or exists (select 1 from fish_listings l join sellers s on s.id = l.seller_id where l.id = new.listing_id and s.is_test)
    or exists (select 1 from buyers b where b.id = new.buyer_id and b.is_test);
  return new;
end;
$$;
drop trigger if exists trg_orders_inherit_is_test on public.orders;
create trigger trg_orders_inherit_is_test
  before insert on public.orders
  for each row execute function public.orders_inherit_is_test();

-- Deletes every is_test order and what hangs off it. Accounts are kept (delete
-- fake accounts explicitly, by id). Returns the number of orders deleted.
-- Payment screenshots in storage are NOT deleted by SQL — remove them through
-- the Storage API using the paths in orders.payment_screenshot_urls first.
create or replace function public.purge_test_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from push_notification_logs p
    where exists (select 1 from orders o where o.is_test and p.url like '%' || o.id::text || '%');
  -- order_feedback cascades. razorpay_payments keeps its rows (order_id → null):
  -- real money moved even on a test order, and the ledger is the audit trail.
  delete from orders where is_test;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.purge_test_orders() from public, anon, authenticated;

------------------------------------------------------------------------------
-- 2. Cart: one server row per listing + price tier, matching the client's
--    cartKey(). The (buyer_id, listing_id) key let two tiers of one listing
--    overwrite each other, and the hydrate wrote a second local line → two
--    orders, two charges. price_snapshot is per-unit (₹100 / 3 pc = 33.333…):
--    numeric(10,2) rounded it to 33.33 → "add ₹0.01 more" min-order blocks.
------------------------------------------------------------------------------
alter table public.buyer_cart add column if not exists pricing_option_id text not null default '';
alter table public.buyer_cart drop constraint if exists buyer_cart_buyer_id_listing_id_key;
do $$ begin
  alter table public.buyer_cart add constraint buyer_cart_buyer_listing_option_key unique (buyer_id, listing_id, pricing_option_id);
exception when duplicate_object or duplicate_table then null; end $$;
alter table public.buyer_cart alter column price_snapshot type numeric;

------------------------------------------------------------------------------
-- 3. Orders keep a copy of the delivery address (orders.buyer_addr only held
--    the saved-address uuid; editing/deleting it rewrote or erased past
--    orders' addresses — 4 prod orders point at deleted rows).
------------------------------------------------------------------------------
alter table public.orders add column if not exists delivery_address jsonb;

update public.orders o
set delivery_address = jsonb_build_object(
  'id', a.id, 'label', a.label, 'flat', a.flat, 'building', a.building,
  'landmark', a.landmark, 'location_name', a.location_name, 'lat', a.lat, 'lng', a.lng)
from public.buyer_addresses a
where o.delivery_address is null and o.buyer_addr = a.id::text;

update public.orders
set delivery_address = jsonb_build_object('location_name', left(buyer_addr, 300))
where delivery_address is null and buyer_addr is not null and buyer_addr <> ''
  and buyer_addr !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

------------------------------------------------------------------------------
-- 4. Inventory bookkeeping (supersedes the bodies from 067; same triggers)
--    a) Deduct clamps at 0 but restore added back the FULL quantity → phantom
--       stock after an oversold order was declined. Record what was actually
--       taken (inventory_deducted_qty) and give back exactly that.
--    b) Pre-orders ignore today's stock at creation (resolve-listing-order-line)
--       but confirming one deducted it from today's stock. Skip pre-orders.
------------------------------------------------------------------------------
alter table public.orders add column if not exists inventory_deducted_qty numeric;

create or replace function public.decrement_listing_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_before numeric; v_take numeric;
begin
  if NEW.listing_id is not null then
    if NEW.status in ('pre_order', 'pending_payment') or coalesce(NEW.is_preorder, false) then
      return NEW;
    end if;
    select weight_avail into v_before from fish_listings where id = NEW.listing_id for update;
    v_take := least(coalesce(v_before, 0), NEW.quantity);
    update fish_listings set weight_avail = coalesce(v_before, 0) - v_take where id = NEW.listing_id;
    update orders set inventory_deducted = true, inventory_deducted_qty = v_take where id = NEW.id;
    update fish_listings set is_available = false where id = NEW.listing_id and weight_avail <= 0;
  end if;
  return NEW;
end;
$$;

create or replace function public.decrement_listing_inventory_on_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_before numeric; v_take numeric;
begin
  if NEW.listing_id is not null
    and OLD.inventory_deducted is false
    and OLD.status in ('pre_order', 'pending_payment')
    and NEW.status = 'confirmed'
    and not coalesce(NEW.is_preorder, false) then
    select weight_avail into v_before from fish_listings where id = NEW.listing_id for update;
    v_take := least(coalesce(v_before, 0), NEW.quantity);
    update fish_listings set weight_avail = coalesce(v_before, 0) - v_take where id = NEW.listing_id;
    update orders set inventory_deducted = true, inventory_deducted_qty = v_take where id = NEW.id;
    update fish_listings set is_available = false where id = NEW.listing_id and weight_avail <= 0;
  end if;
  return NEW;
end;
$$;

create or replace function public.restore_listing_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_back numeric;
begin
  if NEW.listing_id is not null
    and OLD.inventory_deducted is true
    and NEW.status in ('cancelled', 'declined', 'refunded')
    and OLD.status not in ('cancelled', 'declined', 'refunded') then
    -- Rows deducted before this migration have no recorded amount: quantity, as before.
    v_back := coalesce(OLD.inventory_deducted_qty, OLD.quantity);
    update fish_listings set weight_avail = weight_avail + v_back where id = NEW.listing_id;
    update fish_listings set is_available = true where id = NEW.listing_id and weight_avail > 0;
    update orders set inventory_deducted = false, inventory_deducted_qty = null where id = NEW.id;
  end if;
  return NEW;
end;
$$;

------------------------------------------------------------------------------
-- 5. Dead columns (0 code references)
------------------------------------------------------------------------------
alter table public.orders drop column if exists seller_upi_id;        -- prod-only, 0 rows
alter table public.fish_listings drop column if exists delivery_avl;  -- never read

------------------------------------------------------------------------------
-- 6. Security fixes that need no app change
--    - Anyone with the anon key could call reconcile_preorder_price (sets any
--      order's price and status) and the trigger functions via /rest/v1/rpc.
--      The server calls the RPC with the service key; triggers need no grant.
--    - Anon INSERT on orders (`with check (true)`): no browser code inserts.
--    - order-payments bucket was public (048 intended private) and allowed SVG.
--    get_seller_id / get_buyer_id / is_admin stay executable: RLS uses them.
------------------------------------------------------------------------------
revoke execute on function public.reconcile_preorder_price(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.decrement_listing_inventory() from public, anon, authenticated;
revoke execute on function public.decrement_listing_inventory_on_confirm() from public, anon, authenticated;
revoke execute on function public.restore_listing_inventory() from public, anon, authenticated;
alter function public.reconcile_preorder_price(uuid, numeric) set search_path = public;

drop policy if exists "Anyone can create orders" on public.orders;

update storage.buckets
set public = false, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'order-payments';
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'fish-photos';

-- Verify:
--   select count(*) from buyer_cart group by buyer_id, listing_id, pricing_option_id having count(*) > 1;  -- 0 rows
--   select count(*) from orders where buyer_addr is not null and delivery_address is null;                  -- 4 (dangling uuids)
--   select has_function_privilege('anon', 'public.reconcile_preorder_price(uuid,numeric)', 'EXECUTE');       -- false
--   select public from storage.buckets where id = 'order-payments';                                         -- false
