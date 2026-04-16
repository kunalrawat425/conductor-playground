-- Merge max_qty_per_order + max_orders_per_day into one optional per-buyer daily quantity cap.
alter table fish_listings add column if not exists buyer_daily_qty_limit numeric;

-- Prefer per-order cap as the new limit; fall back to old daily order count only if that was set alone.
update fish_listings
set buyer_daily_qty_limit = coalesce(max_qty_per_order, max_orders_per_day::numeric)
where buyer_daily_qty_limit is null
  and (max_qty_per_order is not null or max_orders_per_day is not null);

alter table fish_listings drop column if exists max_qty_per_order;
alter table fish_listings drop column if exists max_orders_per_day;
