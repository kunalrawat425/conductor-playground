-- Extend delivery fee: support per-km pricing in addition to flat fee

alter table sellers add column if not exists delivery_fee_type text not null default 'fixed'
  check (delivery_fee_type in ('fixed', 'per_km'));

alter table sellers add column if not exists delivery_fee_per_km numeric(10, 2) not null default 0;

comment on column sellers.delivery_fee_type is 'fixed = flat fee amount; per_km = fee computed as distance × delivery_fee_per_km';
comment on column sellers.delivery_fee_per_km is 'Per-km rate (₹/km) used when delivery_fee_type = per_km';
