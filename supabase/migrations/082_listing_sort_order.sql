-- Seller-set menu order. Null = not arranged yet: those sort after arranged
-- items, oldest first (the order the seller added them). The ▲/▼ buttons on
-- the dashboard inventory rewrite this for all of a seller's listings.
-- (081 is taken by the open seller-logo branch.)
alter table public.fish_listings
  add column if not exists sort_order integer;
