-- Remove listing expiry column and related index.
-- Listings are now controlled only by is_available + stock/business rules.

drop index if exists idx_listings_available;
create index if not exists idx_listings_available on fish_listings(is_available)
  where is_available = true;

alter table fish_listings
  drop column if exists expires_at;
