-- Square store logo, separate from the wide store photo (store_image_url).
-- The seller page used the banner for the small square avatar too, so logos
-- came out squashed. Code falls back to store_image_url while this is null
-- (or before this migration runs).
alter table public.sellers
  add column if not exists logo_url text;
