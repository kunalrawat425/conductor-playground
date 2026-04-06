-- Unique buyer phone (seller.phone is already unique in 001_initial).
-- Unique non-blank email per table (see 013: replaced with case-sensitive trim-only indexes).

drop index if exists idx_buyers_phone;
create unique index idx_buyers_phone on buyers (phone);

create unique index if not exists buyers_email_lower_unique
  on buyers (lower(trim(email)))
  where trim(coalesce(email, '')) <> '';

create unique index if not exists sellers_email_lower_unique
  on sellers (lower(trim(email)))
  where trim(coalesce(email, '')) <> '';
