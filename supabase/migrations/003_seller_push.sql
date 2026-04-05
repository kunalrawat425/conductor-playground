-- Add push notification fields to sellers
alter table sellers add column if not exists push_subscription jsonb;
alter table sellers add column if not exists push_enabled boolean default false;
