-- Per-listing out-of-stock threshold (default 10% of initial stock or seller-set value)
alter table fish_listings add column if not exists oos_threshold numeric;
