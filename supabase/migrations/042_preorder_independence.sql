-- Pre-order independence: listings can accept pre-orders regardless of inventory.
-- Removes the weight_avail=0 gate — pre-order visibility is now controlled per-listing.

alter table fish_listings
  add column if not exists is_preorder_enabled boolean not null default false,
  add column if not exists preorder_min_qty numeric(10,2) not null default 1,
  add column if not exists preorder_max_qty numeric(10,2); -- NULL = uncapped

comment on column fish_listings.is_preorder_enabled is 'Seller enables pre-orders for this listing independently of stock level';
comment on column fish_listings.preorder_min_qty is 'Minimum quantity buyer must pre-order';
comment on column fish_listings.preorder_max_qty is 'Maximum quantity per pre-order. NULL = no cap.';

-- Per-day schedule for seller: which days open for normal orders + pre-orders
alter table sellers
  add column if not exists open_days text[] not null default array['mon','tue','wed','thu','fri','sat','sun'],
  add column if not exists preorder_days text[] not null default array[]::text[],
  add column if not exists preorder_cutoff_time time not null default '22:00';

comment on column sellers.open_days is 'Days seller is open for normal same-day orders. Values: mon tue wed thu fri sat sun';
comment on column sellers.preorder_days is 'Days seller accepts pre-orders (next-day catch). Empty = no pre-orders.';
comment on column sellers.preorder_cutoff_time is 'Latest time buyer can place a pre-order for next day. Default 22:00.';
