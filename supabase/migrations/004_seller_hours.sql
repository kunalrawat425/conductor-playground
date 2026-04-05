-- Add operating hours to sellers
alter table sellers add column if not exists opens_at time default '05:00';
alter table sellers add column if not exists closes_at time default '14:00';
