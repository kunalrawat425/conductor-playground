-- Test listings for Raju fish HUB (all listing states)
-- Run in Supabase SQL Editor
-- This creates listings covering every case for buyer menu testing

do $$
declare
  raju_id uuid;
begin
  -- Find Raju fish HUB seller
  select id into raju_id from sellers where name ilike '%raju%' limit 1;

  if raju_id is null then
    raise notice 'Raju fish HUB seller not found. Skipping.';
    return;
  end if;

  -- Delete existing listings for clean state
  delete from fish_listings where seller_id = raju_id;

  -- Case 1: In stock, available (normal ADD button)
  insert into fish_listings (seller_id, species, price, price_unit, weight_avail, is_available, pickup_loc, listed_date)
  values (raju_id, 'surmai', 800, 'kg', 10, true, 'Versova Fish Market, Stall #5', now()::date);

  -- Case 2: In stock, available, low stock (shows ⚠️ Low stock)
  insert into fish_listings (seller_id, species, price, price_unit, weight_avail, is_available, pickup_loc, listed_date)
  values (raju_id, 'rawas', 600, 'kg', 1.5, true, 'Versova Fish Market, Stall #5', now()::date);

  -- Case 3: Out of stock (weight_avail = 0, shows PRE-ORDER if accepts_preorder)
  insert into fish_listings (seller_id, species, price, price_unit, weight_avail, is_available, pickup_loc, listed_date)
  values (raju_id, 'pomfret', 1200, 'piece', 0, true, 'Versova Fish Market, Stall #5', now()::date);

  -- Case 4: In stock with max_qty_per_order limit
  insert into fish_listings (seller_id, species, price, price_unit, weight_avail, is_available, pickup_loc, listed_date, max_qty_per_order)
  values (raju_id, 'bangda', 250, 'kg', 20, true, 'Versova Fish Market, Stall #5', now()::date, 5);

  -- Case 5: In stock with max_orders_per_day limit
  insert into fish_listings (seller_id, species, price, price_unit, weight_avail, is_available, pickup_loc, listed_date, max_orders_per_day)
  values (raju_id, 'prawns', 500, 'kg', 8, true, 'Versova Fish Market, Stall #5', now()::date, 10);

  -- Case 6: Out of stock + max_qty limit (PRE-ORDER with limit)
  insert into fish_listings (seller_id, species, price, price_unit, weight_avail, is_available, pickup_loc, listed_date, max_qty_per_order)
  values (raju_id, 'crab', 150, 'piece', 0, true, 'Versova Fish Market, Stall #5', now()::date, 3);

  -- Case 7: Unavailable (seller paused — hidden from buyer menu)
  insert into fish_listings (seller_id, species, price, price_unit, weight_avail, is_available, pickup_loc, listed_date)
  values (raju_id, 'hilsa', 1500, 'kg', 5, false, 'Versova Fish Market, Stall #5', now()::date);

  -- Case 8: In stock, high stock, no limits (simple case)
  insert into fish_listings (seller_id, species, price, price_unit, weight_avail, is_available, pickup_loc, listed_date)
  values (raju_id, 'squid', 400, 'kg', 15, true, 'Versova Fish Market, Stall #5', now()::date);

  -- Make sure Raju accepts pre-orders
  update sellers set accepts_preorder = true where id = raju_id;

  raise notice 'Created 8 test listings for Raju fish HUB (ID: %)', raju_id;
end;
$$;
