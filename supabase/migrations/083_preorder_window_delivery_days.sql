-- Pre-order window start + delivery days (founder, 22 Oct 2026).
-- preorder_opens_at: the pre-order window opens at this time on each pre-order day.
--   Null = today's rule: at closes_at on same-day days, all day on days without same-day orders.
-- delivery_days: weekdays pre-orders are delivered. A pre-order is delivered on the first of
--   these days from the morning after its window's pre-order day. Null = the next morning.
-- A preorder_cutoff_time earlier than the window start (preorder_opens_at, else closes_at)
-- now means the window runs past midnight and closes at that time the next morning
-- (app logic in src/lib/order-timing.ts; no schema change needed for that).
-- Additive and nullable: existing sellers keep their behaviour. Apply BEFORE deploying the
-- app code that selects these columns.
alter table public.sellers
  add column if not exists preorder_opens_at time,
  add column if not exists delivery_days text[];

comment on column public.sellers.preorder_opens_at is
  'Pre-order window opens at this time each pre-order day. Null = at closes_at (or all day with no same-day days).';
comment on column public.sellers.delivery_days is
  'Weekdays pre-orders are delivered (mon..sun). Null = next morning.';
comment on column public.sellers.preorder_cutoff_time is
  'Latest time buyers can pre-order. Earlier than the window start = the next morning (e.g. 03:00). Default 22:00.';
