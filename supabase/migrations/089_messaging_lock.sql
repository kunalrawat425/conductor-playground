-- 089: one messaging run at a time, and at most one marketing WhatsApp per buyer per day (review B2, 31 Oct 2026).
-- Two overlapping runs (the 10-min tick + a manual promo_now) each read message_log before the other
-- wrote, so a buyer got rf2_welcome and rf2_catch_prices 14 s apart.
--
-- cron_lock: /api/cron/messaging takes the 'messaging' row at the start of a live run with
--   update cron_lock set until = now() + interval '9 minutes' where name = 'messaging' and until < now() returning name
-- and sets until = now() when it ends. No row back → another run holds it; this run skips.
-- A run that dies holds the lock for 9 minutes at most, so the next tick still runs.
create table if not exists public.cron_lock (
  name text primary key,
  until timestamptz not null default now()
);
alter table public.cron_lock enable row level security;  -- service role only
insert into public.cron_lock (name, until) values ('messaging', now()) on conflict (name) do nothing;

-- Backstop: one promo / cart / sign-up WhatsApp per buyer per IST day. A second one that day fails the
-- insert with 23505; sendOne reports it as "duplicate" and sends nothing.
-- Failed rows are left out: they don't count as messaged (isReal) and a later message that day may go.
-- dry_run rows (MESSAGING_TEST_ONLY) are left out too, so a test send never blocks a real one.
-- From 1 Nov 2026: 31 Oct already has such pairs (the 09:17 race) and they stay as they are.
create unique index if not exists message_log_one_marketing_a_day
  on public.message_log (buyer_id, slot_date)
  where kind in ('promo', 'act_cart', 'act_signup') and channel = 'whatsapp'
    and status not in ('failed', 'dry_run') and slot_date >= date '2026-11-01';
