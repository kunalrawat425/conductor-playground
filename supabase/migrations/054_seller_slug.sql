-- SEO-friendly URL slugs for sellers
-- Enables /seller/bombay-sea-food instead of /seller/f3339b19-...

alter table sellers add column if not exists slug text unique;

create index if not exists idx_sellers_slug on sellers(slug) where slug is not null;

-- Seed slugs for known sellers
update sellers set slug = 'bombay-sea-food'   where id = 'f3339b19-7baf-44f3-b424-ab7e5c666f01';
update sellers set slug = 'fish-tokri'        where id = '2f39dfce-15c0-4f9a-a5b3-e95280479dbd';
update sellers set slug = 'ocean-lover-fish'  where id = '5f35f96b-7464-4290-b9b1-7935192f6d7f';
update sellers set slug = 'the-fishy-spot'    where id = 'fd5534b2-06e8-4011-93f7-40b677a0758f';
