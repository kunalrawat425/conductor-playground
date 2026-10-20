-- Seller-written size (e.g. "200–300 g", "Pack of 30–40 pcs") and description
-- (e.g. "Cut pieces + head & tail") per listing. The seller page already reads
-- both; until now the columns did not exist, so nothing showed.
alter table public.fish_listings
  add column if not exists size_label text check (size_label is null or char_length(size_label) <= 60),
  add column if not exists description text check (description is null or char_length(description) <= 300);
