-- PRODUCTION ONE-OFF (witoghpdfocywiosmrzv). Not a migration: ids are prod-specific.
-- Run AFTER migrations 069–072. Whole script is one transaction.
--
-- What it does
--   1. Flags test accounts (is_test + "TEST " name prefix):
--        fake sellers  Fishy mart / RAJU Fish HUb / Fresh Catch Mumbai (98765432xx), Seller 0033
--        fake buyers   99001100{11..55}, 9876543210, 9999999999
--        dev account   …9974 buyer + admin seller "Seller 9974" (kept, becomes the ₹1 QA seller)
--   2. Copies every row it will delete into schema _backup_20261008 (not exposed by the API).
--   3. Deletes all test orders (orders of test sellers, orders by test buyers, 4 listing-less
--      junk orders), then the fake accounts and their listings. Real sellers' and real buyers'
--      orders are untouched. The 7 Razorpay-paid dev orders are included (decision D2=A);
--      their payments stay in razorpay_payments (order_id → null) as the money audit trail.
--   4. Sets up the ₹1 QA seller: "TEST Relifish QA", inactive (hidden from every list),
--      reachable only at /seller/337904df-ef4d-4825-b3e6-7767bedf40d2, surmai ₹1/kg pickup.
--
-- After it: delete the backed-up payment screenshots via the Storage API (paths in
-- _backup_20261008.screenshot_paths), and drop the backup schema once you're satisfied.

begin;

-- 1. Flag test accounts --------------------------------------------------------
update sellers set is_test = true,
  name = case when name like 'TEST %' then name else 'TEST ' || name end
where id in (
  '61f02807-15af-4352-bef6-686ae797ea34',  -- Fishy mart
  '052c9f78-2a28-47a5-b70f-cd9221a4c1ff',  -- RAJU Fish HUb
  '74e870ca-2991-4466-b2ad-5669eb6d3da7',  -- Fresh Catch Mumbai
  '4470effc-ee2f-4bde-94f9-4859c8540fba',  -- Seller 0033
  '337904df-ef4d-4825-b3e6-7767bedf40d2'   -- dev seller (kept)
);
update buyers set is_test = true where id in (
  '9bc6c71a-1e5a-415c-b9ec-07819a65a7c1', '095b7eef-fb4d-44a7-903c-69f528004a73',
  '90458900-3954-463b-b274-80528f8c0ef3', 'b2a3b91e-8431-4eee-8474-6b7acac4514c',
  'fa46d75d-a652-41cd-b0b4-5c58fb83afe9', '2b6e9e78-6bad-419d-8a1d-ac7dd30c6904',
  '54aa5fc9-6af9-4784-be89-64e34563b9d3',
  '76a2c702-b332-49ea-b4e4-bcf9ccb1629c'   -- dev buyer (kept)
);

update orders o set is_test = true
where o.listing_id in (select l.id from fish_listings l join sellers s on s.id = l.seller_id where s.is_test)
   or o.buyer_id in (select id from buyers where is_test)
   or o.buyer_phone in (select phone from buyers where is_test)
   or o.id in ('5f3a87aa-e94a-426f-bc32-fa1c902019a9', 'af6e873e-589f-4d2a-83d8-b508178a6a11',
               'f66589a5-5579-46f0-8eef-3beb7185dc5f', '5c3149aa-83d7-461c-926e-de2c1bbe22f7');

-- 2. Backup ----------------------------------------------------------------------
create schema if not exists _backup_20261008;
revoke all on schema _backup_20261008 from public, anon, authenticated;
create table _backup_20261008.orders as select * from orders where is_test;
create table _backup_20261008.order_feedback as select f.* from order_feedback f join orders o on o.id = f.order_id where o.is_test;
create table _backup_20261008.fish_listings as select l.* from fish_listings l join sellers s on s.id = l.seller_id
  where s.is_test and s.id <> '337904df-ef4d-4825-b3e6-7767bedf40d2';
create table _backup_20261008.sellers as select * from sellers where is_test and id <> '337904df-ef4d-4825-b3e6-7767bedf40d2';
create table _backup_20261008.buyers as select * from buyers where is_test and id <> '76a2c702-b332-49ea-b4e4-bcf9ccb1629c';
create table _backup_20261008.screenshot_paths as
  select id as order_id, unnest(payment_screenshot_urls) as path from orders where is_test
  union all select id, refund_screenshot_path from orders where is_test and refund_screenshot_path is not null;

-- 3. Delete ----------------------------------------------------------------------
-- Rows outside the test set that point at fake accounts must let go first.
update orders set payment_verified_by = null
  where payment_verified_by in (select id from sellers where is_test and id <> '337904df-ef4d-4825-b3e6-7767bedf40d2');
update buyer_waitlist set buyer_id = null
  where buyer_id in (select id from buyers where is_test and id <> '76a2c702-b332-49ea-b4e4-bcf9ccb1629c');
update species_ranges set updated_by = null
  where updated_by in (select id from sellers where is_test and id <> '337904df-ef4d-4825-b3e6-7767bedf40d2');

select public.purge_test_orders() as test_orders_deleted;

delete from sellers where is_test and id <> '337904df-ef4d-4825-b3e6-7767bedf40d2';   -- listings, feedback, push logs cascade
delete from buyers  where is_test and id <> '76a2c702-b332-49ea-b4e4-bcf9ccb1629c';   -- cart, addresses, feedback, push logs cascade
-- Dev seller's other listing (pomfret) is test-only too.
delete from fish_listings where seller_id = '337904df-ef4d-4825-b3e6-7767bedf40d2' and species <> 'surmai';

-- 4. ₹1 QA seller ------------------------------------------------------------------
update sellers set
  name = 'TEST Relifish QA',
  is_test = true,
  is_active = false,          -- hidden from /shop, search, sitemap; ordered by direct link
  has_pickup = true,
  min_order_amount = 0,
  opens_at = '05:00', closes_at = '22:00',
  open_days = array['sun','mon','tue','wed','thu','fri','sat']
where id = '337904df-ef4d-4825-b3e6-7767bedf40d2';

update fish_listings set
  is_available = true,
  is_order_paused = false,
  is_preorder_enabled = false,
  deleted_at = null,
  weight_avail = 100,
  pricing_options = '[{"id":"default","unit":"kg","label":"QA ₹1 per kg","price":1,"bundle_size":1}]'::jsonb
where seller_id = '337904df-ef4d-4825-b3e6-7767bedf40d2' and species = 'surmai';

-- Verify (inside the transaction) --------------------------------------------------
select
  (select count(*) from orders) as orders_left,
  (select count(*) from orders where is_test) as test_orders_left,
  (select count(*) from _backup_20261008.orders) as orders_backed_up,
  (select count(*) from sellers where is_test) as test_sellers_left,      -- 1 (QA seller)
  (select count(*) from buyers where is_test) as test_buyers_left,        -- 1 (dev buyer)
  (select count(*) from razorpay_payments where order_id is null) as ledger_rows_detached;

commit;
