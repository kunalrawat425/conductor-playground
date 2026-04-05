-- Saved delivery / pickup addresses per buyer (address book)

create table if not exists buyer_addresses (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references buyers(id) on delete cascade,
  label text not null default '',
  flat text not null default '',
  building text not null default '',
  landmark text not null default '',
  location_name text not null default '',
  lat numeric(10, 7),
  lng numeric(10, 7),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_buyer_addresses_buyer on buyer_addresses(buyer_id);

comment on table buyer_addresses is 'Buyer saved addresses for checkout; API uses service role.';
