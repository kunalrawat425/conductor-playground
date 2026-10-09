-- PRODUCTION ONE-OFF (witoghpdfocywiosmrzv). Not a migration: ids are prod-specific.
-- Run AFTER migrations 069–073. Whole script is one transaction.
--
-- Rule (product owner, 2026-10-08): an account with a real name, address or
-- email is REAL and is kept, even if its phone looks like a dummy. Only
-- accounts with no identity at all are fake.
--
-- Classified from prod data:
--   KEEP  Fishy mart (name, Versova Fish Market, email), RAJU Fish HUb (Worli
--         Koliwada), Fresh Catch Mumbai (Sassoon Dock), Seller 9974 (email,
--         address), buyer …9974 (name, email, 2 saved addresses), every other
--         seller/buyer.
--   FAKE  seller "Seller 0033" (placeholder name, no address/email, 0 listings);
--         buyers 99001100{11,22,33,44,55}, 9876543210, 9999999999 (no name,
--         no email, no saved address).
--
-- What it does
--   1. Copies every row it will delete into schema _backup_20261008 (not exposed by the API).
--   2. Deletes the fake accounts, their orders, and 2 junk orders with no
--      listing and no account (one with phone "…_CHECK", one from a fake buyer).
--   3. Turns Seller 9974 into the ₹1 QA seller "TEST Relifish QA" (is_test,
--      inactive = hidden from every list, reachable only by direct link).
--   Nothing else is deleted. Payments in razorpay_payments are never deleted.

begin;

create temporary table fake_sellers on commit drop as
  select id from sellers where id in ('4470effc-ee2f-4bde-94f9-4859c8540fba');  -- Seller 0033

create temporary table fake_buyers on commit drop as
  select id, phone from buyers where id in (
    '9bc6c71a-1e5a-415c-b9ec-07819a65a7c1', '095b7eef-fb4d-44a7-903c-69f528004a73',
    '90458900-3954-463b-b274-80528f8c0ef3', 'b2a3b91e-8431-4eee-8474-6b7acac4514c',
    'fa46d75d-a652-41cd-b0b4-5c58fb83afe9', '2b6e9e78-6bad-419d-8a1d-ac7dd30c6904',
    '54aa5fc9-6af9-4784-be89-64e34563b9d3');

-- Safety: abort if any "fake" account has a name, email or saved address.
do $$ begin
  if exists (select 1 from sellers s join fake_sellers f on f.id = s.id
             where coalesce(s.email, '') <> '' or coalesce(s.location, '') <> '' or coalesce(s.location_name, '') <> ''
                or coalesce(s.first_name, '') <> '' or coalesce(s.last_name, '') <> '')
  or exists (select 1 from buyers b join fake_buyers f on f.id = b.id
             where coalesce(b.email, '') <> '' or coalesce(b.first_name, '') <> '' or coalesce(b.last_name, '') <> ''
                or exists (select 1 from buyer_addresses a where a.buyer_id = b.id)) then
    raise exception 'A listed fake account has a real name/email/address — stop and re-check';
  end if;
end $$;

-- Orders to delete: placed by a fake buyer, placed with a fake seller, or junk
-- with neither a listing nor an account.
create temporary table fake_orders on commit drop as
  select o.id from orders o
  where o.buyer_id in (select id from fake_buyers)
     or right(o.buyer_phone, 10) in (select right(phone, 10) from fake_buyers)
     or o.listing_id in (select l.id from fish_listings l where l.seller_id in (select id from fake_sellers))
     or o.id in ('af6e873e-589f-4d2a-83d8-b508178a6a11', '5f3a87aa-e94a-426f-bc32-fa1c902019a9');

-- 1. Backup ----------------------------------------------------------------------
create schema if not exists _backup_20261008;
revoke all on schema _backup_20261008 from public, anon, authenticated;
create table _backup_20261008.orders as select * from orders where id in (select id from fake_orders);
create table _backup_20261008.order_feedback as select * from order_feedback where order_id in (select id from fake_orders);
create table _backup_20261008.fish_listings as select * from fish_listings where seller_id in (select id from fake_sellers);
create table _backup_20261008.sellers as select * from sellers where id in (select id from fake_sellers);
create table _backup_20261008.buyers as select * from buyers where id in (select id from fake_buyers);
create table _backup_20261008.screenshot_paths as
  select id as order_id, unnest(payment_screenshot_urls) as path from orders where id in (select id from fake_orders)
  union all select id, refund_screenshot_path from orders where id in (select id from fake_orders) and refund_screenshot_path is not null;

-- 2. Delete ----------------------------------------------------------------------
update orders set is_test = true where id in (select id from fake_orders);
update orders set payment_verified_by = null where payment_verified_by in (select id from fake_sellers);
update buyer_waitlist set buyer_id = null where buyer_id in (select id from fake_buyers);
update species_ranges set updated_by = null where updated_by in (select id from fake_sellers);

select public.purge_test_orders() as fake_orders_deleted;
delete from sellers where id in (select id from fake_sellers);   -- listings, feedback, push logs cascade
delete from buyers  where id in (select id from fake_buyers);    -- cart, addresses, feedback, push logs cascade

-- 3. ₹1 QA seller ------------------------------------------------------------------
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
  (select count(*) from _backup_20261008.orders)  as orders_deleted,       -- expect 18
  (select count(*) from _backup_20261008.sellers) as sellers_deleted,      -- expect 1
  (select count(*) from _backup_20261008.buyers)  as buyers_deleted,       -- expect 7
  (select count(*) from orders)                   as orders_left,          -- expect 319
  (select count(*) from sellers)                  as sellers_left,         -- expect 23
  (select count(*) from buyers)                   as buyers_left;          -- expect 18

commit;
