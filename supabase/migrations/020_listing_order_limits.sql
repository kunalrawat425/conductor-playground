-- Per-listing order limits
alter table fish_listings add column if not exists max_qty_per_order numeric;
alter table fish_listings add column if not exists max_orders_per_day int;
