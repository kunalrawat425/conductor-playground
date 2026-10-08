-- 069: Razorpay payment ledger + payment_type derived from payment_method
--
-- Why a ledger:
--   orders holds ONE razorpay_order_id / razorpay_payment_id pair. A pre-order
--   whose final price comes in higher is paid twice (upfront + balance), and the
--   balance payment overwrote the upfront payment id — the only handle a refund
--   has. A payment that lands after the order was cancelled was not recorded
--   anywhere at all (webhook matched 0 rows and logged "OK").
--   Every captured payment now gets one row here, keyed by Razorpay's own id,
--   written by whichever path sees it first (verify, webhook, cron, admin, seller).
--
-- Why the trigger:
--   every create path hardcoded payment_type = 'cod' and nothing ever updated
--   it, so all Razorpay-paid orders read "cod" in the table editor and admin
--   tools. payment_method is the column every payment writer already sets;
--   payment_type is now derived from it in one place and cannot drift.
--
-- Safe on both staging and prod. Idempotent.

create table if not exists public.razorpay_payments (
  razorpay_payment_id text primary key,
  razorpay_order_id   text not null,
  order_id            uuid references public.orders(id) on delete set null,
  source              text not null,   -- verify | webhook | cron | admin | seller | create_order | backfill
  refund_id           text,
  refunded_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_razorpay_payments_order on public.razorpay_payments(order_id);
create index if not exists idx_razorpay_payments_rzp_order on public.razorpay_payments(razorpay_order_id);

-- Service role only. No policies on purpose.
alter table public.razorpay_payments enable row level security;
revoke all on public.razorpay_payments from anon, authenticated;

insert into public.razorpay_payments (razorpay_payment_id, razorpay_order_id, order_id, source, created_at)
select razorpay_payment_id, coalesce(razorpay_order_id, ''), id, 'backfill', coalesce(payment_verified_at, created_at)
from public.orders
where razorpay_payment_id is not null
on conflict (razorpay_payment_id) do nothing;

-- One order per Razorpay order / payment. Prod had 0 duplicates when written.
create unique index if not exists uq_orders_razorpay_order_id
  on public.orders(razorpay_order_id) where razorpay_order_id is not null;
create unique index if not exists uq_orders_razorpay_payment_id
  on public.orders(razorpay_payment_id) where razorpay_payment_id is not null;

create or replace function public.sync_order_payment_type()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.payment_type := case
    when new.payment_method = 'razorpay'   then 'online'
    when new.payment_method = 'cod_legacy' then 'cod'
    when new.payment_verified_at is not null
      or coalesce(array_length(new.payment_screenshot_urls, 1), 0) > 0 then 'upi'
    else 'unpaid'
  end;
  return new;
end;
$$;

drop trigger if exists trg_sync_order_payment_type on public.orders;
create trigger trg_sync_order_payment_type
  before insert or update on public.orders
  for each row execute function public.sync_order_payment_type();

comment on column public.orders.payment_type is
  'Derived by trg_sync_order_payment_type from payment_method: online | upi | cod (legacy) | unpaid. Do not write directly.';

-- Backfill: touching the row fires the trigger.
update public.orders set payment_type = payment_type;

-- Verify (expect 0):
--   select count(*) from orders where payment_method = 'razorpay' and payment_type <> 'online';
--   select count(*) from orders o where razorpay_payment_id is not null
--     and not exists (select 1 from razorpay_payments p where p.razorpay_payment_id = o.razorpay_payment_id);
--
-- Rollback:
--   drop trigger trg_sync_order_payment_type on orders; drop function sync_order_payment_type();
--   drop index uq_orders_razorpay_order_id; drop index uq_orders_razorpay_payment_id;
--   drop table razorpay_payments;
