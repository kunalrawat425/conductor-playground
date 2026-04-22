-- Persistent buyer cart (cross-device, multi-seller global cart)
-- One row per (buyer_id, listing_id). Cart is grouped by seller at checkout.

create table if not exists buyer_cart (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references buyers(id) on delete cascade,
  listing_id uuid not null references fish_listings(id) on delete cascade,
  qty numeric(10, 3) not null check (qty > 0),
  qty_unit text not null default 'kg',
  price_snapshot numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_id, listing_id)
);

create index if not exists idx_buyer_cart_buyer on buyer_cart(buyer_id);
create index if not exists idx_buyer_cart_listing on buyer_cart(listing_id);

comment on table buyer_cart is 'Persistent cross-device cart for buyers. API uses service role; one order per seller at checkout.';
