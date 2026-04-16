-- Structured size grade per listing (buyer-visible): small / medium / large
alter table fish_listings add column if not exists fish_size text;

alter table fish_listings drop constraint if exists fish_listings_fish_size_check;

alter table fish_listings
  add constraint fish_listings_fish_size_check
  check (fish_size is null or fish_size in ('small', 'medium', 'large'));
