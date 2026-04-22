-- Pre-order buyer preferences: cut style + special request notes.

alter table orders
  add column if not exists buyer_notes text default '',
  add column if not exists cut_style text default '';

comment on column orders.buyer_notes is 'Free-text special request from buyer (e.g. "medium size pieces, no head")';
comment on column orders.cut_style is 'Cut preference: whole, cleaned, or cut';
