-- Add last_promo_push_sent_at to buyers to prevent duplicate promo push notifications in overlapping windows
alter table buyers add column if not exists last_promo_push_sent_at timestamptz default null;
