-- Soft-delete column for fish_listings so seller "Delete" doesn't break order FKs.
-- Buyer + seller dashboard queries should `.is("deleted_at", null)` to hide deleted rows.

alter table fish_listings
  add column if not exists deleted_at timestamptz;

create index if not exists idx_fish_listings_deleted_at on fish_listings(deleted_at);

comment on column fish_listings.deleted_at is 'Set when seller deletes a listing; existing orders keep the FK pointer.';
