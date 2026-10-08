-- Runs inside a transaction and rolls back. Raises on the first failed check.
-- Local: docker exec -i <db container> psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/069_071_triggers.test.sql
begin;

do $$
declare
  s_id uuid; t_id uuid; l_id uuid; tl_id uuid; b_id uuid; tb_id uuid;
  oa uuid; ob uuid; op uuid; ot uuid; v numeric; vt text; n int;
begin
  insert into sellers (phone, name, location, location_name) values ('9000000001', 'Real Seller', '', '') returning id into s_id;
  insert into sellers (phone, name, location, location_name, is_test) values ('9000000002', 'TEST Seller', '', '', true) returning id into t_id;
  insert into buyers (phone) values ('9000000011') returning id into b_id;
  insert into buyers (phone, is_test) values ('9000000012', true) returning id into tb_id;
  insert into fish_listings (seller_id, species, weight_avail, pickup_loc, pricing_options)
    values (s_id, 'surmai', 2, '', '[{"id":"default","unit":"kg","price":100}]') returning id into l_id;
  insert into fish_listings (seller_id, species, weight_avail, pickup_loc, pricing_options)
    values (t_id, 'surmai', 5, '', '[{"id":"default","unit":"kg","price":1}]') returning id into tl_id;

  -- Oversell: two pending orders for the last 2 kg both confirm.
  insert into orders (listing_id, buyer_id, buyer_phone, quantity, status, total_price) values (l_id, b_id, '9000000011', 2, 'pending_payment', 200) returning id into oa;
  insert into orders (listing_id, buyer_id, buyer_phone, quantity, status, total_price) values (l_id, b_id, '9000000011', 2, 'pending_payment', 200) returning id into ob;
  update orders set status = 'confirmed', payment_method = 'razorpay', razorpay_payment_id = 'pay_a' where id = oa;
  update orders set status = 'confirmed', payment_method = 'razorpay', razorpay_payment_id = 'pay_b' where id = ob;
  select weight_avail into v from fish_listings where id = l_id;
  if v <> 0 then raise exception 'stock after two confirms: expected 0, got %', v; end if;
  select inventory_deducted_qty into v from orders where id = ob;
  if v <> 0 then raise exception 'oversold order should record 0 taken, got %', v; end if;
  -- Declining the oversold order must not invent stock (was +2 phantom).
  update orders set status = 'declined' where id = ob;
  select weight_avail into v from fish_listings where id = l_id;
  if v <> 0 then raise exception 'phantom stock after declining oversold order: %', v; end if;
  update orders set status = 'declined' where id = oa;
  select weight_avail into v from fish_listings where id = l_id;
  if v <> 2 then raise exception 'restore after declining the real order: expected 2, got %', v; end if;

  -- Confirming a pre-order must not take today's stock.
  insert into orders (listing_id, buyer_id, buyer_phone, quantity, status, total_price, is_preorder, placement_kind)
    values (l_id, b_id, '9000000011', 1, 'pending_payment', 100, true, 'preorder') returning id into op;
  update orders set status = 'confirmed', payment_method = 'razorpay', razorpay_payment_id = 'pay_p' where id = op;
  select weight_avail into v from fish_listings where id = l_id;
  if v <> 2 then raise exception 'pre-order confirm took stock: %', v; end if;

  -- payment_type is derived, whatever the writer sends.
  insert into orders (listing_id, buyer_phone, quantity, status, total_price, payment_type) values (l_id, '9000000011', 1, 'pending_payment', 100, 'cod') returning id into oa;
  select payment_type into vt from orders where id = oa;
  if vt <> 'unpaid' then raise exception 'payment_type on new order: %', vt; end if;
  update orders set payment_method = 'razorpay', razorpay_payment_id = 'pay_x', status = 'confirmed' where id = oa;
  select payment_type into vt from orders where id = oa;
  if vt <> 'online' then raise exception 'payment_type after razorpay: %', vt; end if;

  -- is_test inherited from seller or buyer; purge removes only test orders.
  insert into orders (listing_id, buyer_phone, quantity, status, total_price) values (tl_id, '9000000011', 1, 'pending_payment', 1) returning id into ot;
  if not (select is_test from orders where id = ot) then raise exception 'order of test seller not is_test'; end if;
  insert into orders (listing_id, buyer_id, buyer_phone, quantity, status, total_price) values (l_id, tb_id, '9000000012', 1, 'pending_payment', 100) returning id into ot;
  if not (select is_test from orders where id = ot) then raise exception 'order of test buyer not is_test'; end if;
  n := purge_test_orders();
  if n <> 2 then raise exception 'purge_test_orders deleted %, expected 2', n; end if;
  if exists (select 1 from orders where is_test) then raise exception 'test orders left after purge'; end if;
  if not exists (select 1 from orders where id = op) then raise exception 'purge deleted a real order'; end if;

  -- Seller stats follow the data.
  update orders set status = 'ready_for_pickup' where id = op;
  update orders set status = 'completed' where id = op;
  insert into order_feedback (order_id, buyer_id, seller_id, rating, feedback) values (op, b_id, s_id, 4, 'ok');
  if (select total_orders from sellers where id = s_id) <> 1 then raise exception 'total_orders not maintained'; end if;
  if (select rating_count from sellers where id = s_id) <> 1 or (select rating_avg from sellers where id = s_id) <> 4 then
    raise exception 'rating not maintained'; end if;

  -- Cart: two tiers of one listing are two rows; same tier twice is rejected.
  insert into buyer_cart (buyer_id, listing_id, qty, qty_unit, price_snapshot, pricing_option_id) values (b_id, l_id, 1, 'kg', 33.333333, 'opt_0');
  insert into buyer_cart (buyer_id, listing_id, qty, qty_unit, price_snapshot, pricing_option_id) values (b_id, l_id, 1, 'kg', 50, 'opt_1');
  if (select price_snapshot from buyer_cart where pricing_option_id = 'opt_0' and buyer_id = b_id) <> 33.333333 then
    raise exception 'price_snapshot still rounded'; end if;
  begin
    insert into buyer_cart (buyer_id, listing_id, qty, qty_unit, price_snapshot, pricing_option_id) values (b_id, l_id, 1, 'kg', 50, 'opt_1');
    raise exception 'duplicate cart tier accepted';
  exception when unique_violation then null; end;

  -- Ledger rejects a duplicate payment id.
  insert into razorpay_payments (razorpay_payment_id, razorpay_order_id, order_id, source) values ('pay_dup', 'order_1', op, 'test');
  begin
    insert into razorpay_payments (razorpay_payment_id, razorpay_order_id, order_id, source) values ('pay_dup', 'order_1', op, 'test');
    raise exception 'duplicate payment id accepted';
  exception when unique_violation then null; end;
end $$;

-- Permissions
do $$ begin
  if has_function_privilege('anon', 'public.reconcile_preorder_price(uuid,numeric)', 'EXECUTE') then
    raise exception 'anon can still execute reconcile_preorder_price'; end if;
  if has_function_privilege('anon', 'public.purge_test_orders()', 'EXECUTE') then
    raise exception 'anon can execute purge_test_orders'; end if;
  if exists (select 1 from pg_policies where tablename = 'orders' and policyname = 'Anyone can create orders') then
    raise exception 'anon insert policy still present'; end if;
  if to_regclass('public.otp_attempts') is not null then raise exception 'otp_attempts not dropped'; end if;
end $$;

select 'ALL TRIGGER TESTS PASSED' as result;
rollback;
