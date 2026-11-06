-- Pay on delivery (founder, 6 Nov 2026). Never cash: after "Place order" the buyer may choose to pay
-- in the app (Razorpay) when the fish arrives instead of now. Only at sellers who switch it on.
--
-- A pay-on-delivery order goes to the seller unpaid: the seller can confirm it and send it out, but it
-- can only be marked delivered/picked up once the buyer's Razorpay payment is on it.
-- Idempotent.

alter table public.sellers add column if not exists accepts_pay_on_delivery boolean not null default false;
alter table public.orders add column if not exists pay_on_delivery boolean not null default false;

-- Before: any fulfilment status needed a payment (Razorpay id, a verified-at stamp, or a legacy COD row).
-- Now a pay-on-delivery order may also be confirmed / on its way unpaid. Delivered still needs the money,
-- and its verified-at stamp alone no longer counts (only Razorpay sets the stamp with a real payment).
alter table public.orders drop constraint if exists orders_fulfilment_needs_payment;
alter table public.orders add constraint orders_fulfilment_needs_payment
  check (status not in ('paid', 'confirmed', 'ready_for_pickup', 'out_for_delivery', 'completed', 'picked_up')
         or razorpay_payment_id is not null
         or (payment_verified_at is not null and not pay_on_delivery)
         or payment_method is not distinct from 'cod_legacy'
         or (pay_on_delivery and status in ('confirmed', 'ready_for_pickup', 'out_for_delivery')));

-- The 2-hour expiry and the open-order check look orders up per buyer.
create index if not exists orders_pay_on_delivery_buyer_idx on public.orders (buyer_id) where pay_on_delivery;

-- Fishtokri is the first seller on pay on delivery (founder, 6 Nov). No-op where the row doesn't exist.
update public.sellers set accepts_pay_on_delivery = true where id = '2f39dfce-15c0-4f9a-a5b3-e95280479dbd';

-- Unpaid orders now expire after 2 hours, so the expiry runs every 10 minutes from pg_cron (it was a
-- daily Vercel cron). Run once per environment as postgres, after storing the cron secret in Vault
-- (the same secret as messaging_cron_secret works; the endpoint checks CRON_SECRET):
--   select cron.schedule('expire-unpaid', '*/10 * * * *', $$
--     select net.http_get(
--       url := 'https://www.relifish.com/api/cron/expire-pending-orders',
--       headers := jsonb_build_object('Authorization', 'Bearer ' ||
--         (select decrypted_secret from vault.decrypted_secrets where name = 'messaging_cron_secret')),
--       timeout_milliseconds := 55000)
--   $$);
