-- Pre-order price range: seller declares estimated min/max price for next-day catch.
-- Buyers see this range upfront so they know what to expect before paying.
-- Seller sets the actual final_price after the catch via reconcile_preorder_price.

alter table fish_listings
  add column if not exists preorder_price_min numeric(10,2),
  add column if not exists preorder_price_max numeric(10,2);

comment on column fish_listings.preorder_price_min is 'Estimated minimum price seller will charge for this pre-order listing';
comment on column fish_listings.preorder_price_max is 'Estimated maximum price seller will charge for this pre-order listing';
