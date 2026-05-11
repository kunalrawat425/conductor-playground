-- Add 'jumbo' as valid fish_size grade (e.g. jumbo prawns)
alter table fish_listings drop constraint if exists fish_listings_fish_size_check;

alter table fish_listings
  add constraint fish_listings_fish_size_check
  check (fish_size is null or fish_size in ('small', 'medium', 'large', 'jumbo'));
