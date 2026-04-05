-- ============================================
-- MOCK DATA: Buyers + Orders
-- Run AFTER run-me.sql if you need to add mock data separately
-- Paste into Supabase SQL Editor → Run
-- ============================================

-- 5 Mock Buyers across Mumbai
insert into buyers (phone, lat, lng, location_name)
values
  ('9900110011', 19.1200, 72.8300, 'Andheri West'),
  ('9900110022', 18.9700, 72.8200, 'Dadar'),
  ('9900110033', 19.0600, 72.8400, 'Bandra West'),
  ('9900110044', 19.1400, 72.8100, 'Versova'),
  ('9900110055', 18.9200, 72.8300, 'Colaba')
on conflict do nothing;

-- 8 Mock Orders (various statuses)
do $$
declare
  s1 uuid; s2 uuid; s3 uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid;
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; b5 uuid;
begin
  select id into s1 from sellers where phone = '9876543210';
  select id into s2 from sellers where phone = '9876543211';
  select id into s3 from sellers where phone = '9876543212';

  select id into l1 from fish_listings where seller_id = s1 and species = 'pomfret' limit 1;
  select id into l2 from fish_listings where seller_id = s1 and species = 'surmai' limit 1;
  select id into l3 from fish_listings where seller_id = s1 and species = 'bangda' limit 1;
  select id into l4 from fish_listings where seller_id = s2 and species = 'rawas' limit 1;
  select id into l5 from fish_listings where seller_id = s3 and species = 'crab' limit 1;

  select id into b1 from buyers where phone = '9900110011';
  select id into b2 from buyers where phone = '9900110022';
  select id into b3 from buyers where phone = '9900110033';
  select id into b4 from buyers where phone = '9900110044';
  select id into b5 from buyers where phone = '9900110055';

  if l1 is not null and b1 is not null then
    -- Pending: Andheri buyer wants pomfret pickup
    insert into orders (listing_id, species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type)
    values (l1, 'pomfret', '9900110011', b1, 2, 'kg', 1100, 'pending', 'pickup', 'cod');

    -- Confirmed: Dadar buyer wants surmai delivery
    insert into orders (listing_id, species, buyer_phone, buyer_id, buyer_addr, quantity, quantity_unit, total_price, status, order_type, payment_type)
    values (l2, 'surmai', '9900110022', b2, '42 Shivaji Park, Dadar West', 1, 'kg', 700, 'confirmed', 'delivery', 'cod');

    -- Completed: bangda pickup yesterday
    insert into orders (listing_id, species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type, created_at)
    values (l3, 'bangda', '9900110033', b3, 3, 'kg', 450, 'completed', 'pickup', 'cod', now() - interval '1 day');

    -- Cancelled: pomfret pickup
    insert into orders (listing_id, species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type, created_at)
    values (l1, 'pomfret', '9900110044', b4, 1, 'kg', 550, 'cancelled', 'pickup', 'cod', now() - interval '2 hours');
  end if;

  if l4 is not null and b5 is not null then
    -- Pending delivery: Colaba buyer wants rawas
    insert into orders (listing_id, species, buyer_phone, buyer_id, buyer_addr, quantity, quantity_unit, total_price, status, order_type, payment_type)
    values (l4, 'rawas', '9900110055', b5, '12 Shahid Bhagat Singh Rd, Colaba', 2, 'kg', 900, 'pending', 'delivery', 'cod');
  end if;

  if l5 is not null and b2 is not null then
    -- Pre-order: crabs for tomorrow
    insert into orders (listing_id, species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type, paid_amount)
    values (l5, 'crab', '9900110022', b2, 5, 'piece', 750, 'pre_order', 'pickup', 'cod', 750);
  end if;

  -- Species-only pre-order (no listing, just species)
  if b3 is not null then
    insert into orders (species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type, paid_amount)
    values ('lobster', '9900110033', b3, 2, 'piece', 1600, 'pre_order', 'pickup', 'cod', 1600);
  end if;

  -- Declined: pomfret from yesterday
  if l1 is not null and b5 is not null then
    insert into orders (listing_id, species, buyer_phone, buyer_id, quantity, quantity_unit, total_price, status, order_type, payment_type, created_at)
    values (l1, 'pomfret', '9900110055', b5, 5, 'kg', 2750, 'declined', 'pickup', 'cod', now() - interval '1 day');
  end if;
end $$;

-- Update seller order counts
update sellers set total_orders = (
  select count(*) from orders o
  join fish_listings fl on o.listing_id = fl.id
  where fl.seller_id = sellers.id
);

-- ============================================
-- DONE! Added:
--   ✅ 5 buyers: Andheri, Dadar, Bandra, Versova, Colaba
--   ✅ 8 orders across all statuses:
--      - 2 pending (1 pickup, 1 delivery)
--      - 1 confirmed (delivery with address)
--      - 1 completed (yesterday)
--      - 1 cancelled
--      - 1 declined (yesterday)
--      - 2 pre-orders (1 with listing, 1 species-only)
--   ✅ Seller total_orders updated
-- ============================================
