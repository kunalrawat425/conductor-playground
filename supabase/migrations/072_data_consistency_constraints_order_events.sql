-- 072: make existing data consistent, then make each inconsistency impossible,
--      and keep a history of every order state change.
-- Every backfill below derives from data already on the row — nothing invented.
-- Checked against prod 2026-10-08 (counts in comments). Safe on staging + prod.

------------------------------------------------------------------------------
-- A. Backfills
------------------------------------------------------------------------------

-- A1. Razorpay-paid but never stamped verified (1 row: b3f1cced, the order that
--     "was paid but showed unpaid / COD"). The payment id is the proof.
update public.orders o
set payment_verified_at = coalesce(
  (select p.created_at from public.razorpay_payments p where p.razorpay_payment_id = o.razorpay_payment_id),
  o.created_at)
where o.razorpay_payment_id is not null and o.payment_verified_at is null;

-- A2. Pre-orders the flag missed (is_preorder came in 057; older rows default false):
--     status pre_order (55) or a seller-set final price (20) only happen to pre-orders.
update public.orders
set is_preorder = true
where not coalesce(is_preorder, false)
  and (status = 'pre_order' or placement_kind = 'preorder' or final_price is not null);

-- A3. placement_kind null on 314 older rows; readers fall back to is_preorder.
update public.orders
set placement_kind = case when is_preorder then 'preorder' else 'same_day' end
where placement_kind is null;

-- A4. Fulfilled orders with no payment record, all created 2026-04-04..04-22 —
--     before the first Razorpay order (2026-05-18). Same legacy marker 064 used.
update public.orders
set payment_method = 'cod_legacy', payment_verified_at = coalesce(payment_verified_at, created_at)
where status in ('confirmed', 'ready_for_pickup', 'out_for_delivery', 'completed', 'picked_up')
  and razorpay_payment_id is null and payment_verified_at is null
  and coalesce(payment_method, '') <> 'cod_legacy'
  and created_at < '2026-05-18';

-- A5. paid_amount null on 93 old rows. It holds what the buyer is charged
--     (total + delivery); fill it only where the payment is evidenced.
update public.orders
set paid_amount = total_price + coalesce(delivery_fee, 0)
where paid_amount is null
  and (razorpay_payment_id is not null or payment_verified_at is not null or payment_method = 'cod_legacy');

-- A6. fish_listings.expires_at: listing expiry was removed in 011 and 059 drops
--     the column, but prod still has it (59/68 "expired", none read by code).
alter table public.fish_listings drop column if exists expires_at;

------------------------------------------------------------------------------
-- B. Constraints — new rows can no longer drift. NOT VALID where legacy rows
--    would fail; validated straight away where the data is already clean.
--    Null-safe on purpose: a CHECK passes when it evaluates to NULL, so
--    `payment_method = 'cod_legacy'` with payment_method NULL let everything
--    through. 064's orders_confirmed_needs_payment had exactly that hole — an
--    unpaid order with no payment_method could be `confirmed` — so it is
--    replaced by orders_fulfilment_needs_payment below.
------------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_confirmed_needs_payment;
alter table public.orders drop constraint if exists orders_razorpay_id_means_razorpay;
alter table public.orders drop constraint if exists orders_fulfilment_needs_payment;
do $$ begin
  -- a Razorpay payment id means the order was paid on Razorpay
  alter table public.orders add constraint orders_razorpay_id_means_razorpay
    check (razorpay_payment_id is null or payment_method is not distinct from 'razorpay') not valid;
exception when duplicate_object then null; end $$;
alter table public.orders validate constraint orders_razorpay_id_means_razorpay;

do $$ begin
  -- any fulfilment status needs a payment record (064 only covered `confirmed`)
  alter table public.orders add constraint orders_fulfilment_needs_payment
    check (status not in ('confirmed', 'ready_for_pickup', 'out_for_delivery', 'completed', 'picked_up')
           or razorpay_payment_id is not null or payment_verified_at is not null
           or payment_method is not distinct from 'cod_legacy') not valid;
exception when duplicate_object then null; end $$;
alter table public.orders validate constraint orders_fulfilment_needs_payment;

do $$ begin
  alter table public.orders add constraint orders_amounts_sane
    check (quantity > 0 and total_price >= 0 and delivery_fee >= 0
           and coalesce(paid_amount, 0) >= 0 and coalesce(refund_amt, 0) >= 0 and coalesce(final_price, 0) >= 0) not valid;
exception when duplicate_object then null; end $$;
alter table public.orders validate constraint orders_amounts_sane;

do $$ begin
  alter table public.orders add constraint orders_payment_method_values
    check (payment_method is null or payment_method in ('razorpay', 'cod_legacy')) not valid;
exception when duplicate_object then null; end $$;
alter table public.orders validate constraint orders_payment_method_values;

do $$ begin
  alter table public.orders add constraint orders_cancelled_by_values
    check (cancelled_by is null or cancelled_by in ('buyer', 'seller', 'system', 'admin')) not valid;
exception when duplicate_object then null; end $$;
alter table public.orders validate constraint orders_cancelled_by_values;

do $$ begin
  -- 7 legacy cancelled/declined rows have no actor; new ones must say who
  alter table public.orders add constraint orders_cancel_has_actor
    check (status not in ('cancelled', 'declined') or cancelled_by is not null) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  -- one stored phone format (070 normalised writers + backfill; 2 junk legacy rows)
  alter table public.orders add constraint orders_buyer_phone_format
    check (buyer_phone ~ '^[6-9][0-9]{9}$') not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.buyers add constraint buyers_phone_format check (phone ~ '^[6-9][0-9]{9}$') not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sellers add constraint sellers_phone_format check (phone ~ '^[6-9][0-9]{9}$') not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.fish_listings add constraint fish_listings_amounts_sane
    check (weight_avail >= 0 and coalesce(buyer_daily_qty_limit, 0) >= 0 and coalesce(oos_threshold, 0) >= 0
           and jsonb_typeof(pricing_options) = 'array' and jsonb_array_length(pricing_options) between 1 and 3) not valid;
exception when duplicate_object then null; end $$;
alter table public.fish_listings validate constraint fish_listings_amounts_sane;

do $$ begin
  alter table public.sellers add constraint sellers_amounts_sane
    check (min_order_amount >= 0 and delivery_fee_amount >= 0 and delivery_fee_per_km >= 0
           and coalesce(free_delivery_above, 0) >= 0 and coalesce(delivery_rad, 0) >= 0
           and (opens_at is null or closes_at is null or opens_at <> closes_at)) not valid;
exception when duplicate_object then null; end $$;
alter table public.sellers validate constraint sellers_amounts_sane;

-- at most one default address per buyer
create unique index if not exists uq_buyer_addresses_one_default
  on public.buyer_addresses(buyer_id) where is_default;

------------------------------------------------------------------------------
-- C. Order history. There was no record of how an order reached its state,
--    so "the buyer paid but it showed unpaid" could not be reconstructed.
--    Every insert and every status / payment change is now logged.
------------------------------------------------------------------------------
alter table public.orders add column if not exists updated_at timestamptz not null default now();

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  at timestamptz not null default now(),
  old_status text,
  new_status text,
  payment_method text,
  razorpay_order_id text,
  razorpay_payment_id text,
  payment_verified_at timestamptz,
  refund_amt numeric,
  refund_sent_at timestamptz,
  cancelled_by text,
  db_role text not null default current_user
);
create index if not exists idx_order_events_order on public.order_events(order_id, at);
alter table public.order_events enable row level security;      -- service role only
revoke all on public.order_events from anon, authenticated;

create or replace function public.log_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.status is not distinct from old.status
       and new.payment_method is not distinct from old.payment_method
       and new.razorpay_order_id is not distinct from old.razorpay_order_id
       and new.razorpay_payment_id is not distinct from old.razorpay_payment_id
       and new.payment_verified_at is not distinct from old.payment_verified_at
       and new.refund_sent_at is not distinct from old.refund_sent_at
       and new.final_price is not distinct from old.final_price then
      return new;
    end if;
  end if;
  insert into order_events (order_id, old_status, new_status, payment_method, razorpay_order_id,
                            razorpay_payment_id, payment_verified_at, refund_amt, refund_sent_at, cancelled_by)
  values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, new.payment_method,
          new.razorpay_order_id, new.razorpay_payment_id, new.payment_verified_at, new.refund_amt,
          new.refund_sent_at, new.cancelled_by);
  return new;
end;
$$;
revoke execute on function public.log_order_event() from public, anon, authenticated;

-- AFTER INSERT (the row must exist for the FK); BEFORE UPDATE (also stamps updated_at).
drop trigger if exists trg_order_events_insert on public.orders;
create trigger trg_order_events_insert after insert on public.orders
  for each row execute function public.log_order_event();
drop trigger if exists trg_order_events_update on public.orders;
create trigger trg_order_events_update before update on public.orders
  for each row execute function public.log_order_event();

------------------------------------------------------------------------------
-- D. Indexes — shaped like the real queries; drop the dead ones.
------------------------------------------------------------------------------
create index if not exists idx_orders_listing_status_created on public.orders(listing_id, status, created_at desc);
create index if not exists idx_orders_buyer_created on public.orders(buyer_id, created_at desc);
create index if not exists idx_orders_payment_verified_by on public.orders(payment_verified_by) where payment_verified_by is not null;
drop index if exists public.idx_orders_scheduled;   -- scheduled slots are disabled; 0 scans
drop index if exists public.idx_buyers_auth;        -- duplicate of buyers_auth_id_key; auth_id is always null

-- Verify (expect 0 each):
--   select count(*) from orders where razorpay_payment_id is not null and payment_verified_at is null;
--   select count(*) from orders where status = 'pre_order' and not is_preorder;
--   select count(*) from orders where placement_kind is null;
--   select conname, convalidated from pg_constraint where conrelid = 'orders'::regclass and conname like 'orders_%';
