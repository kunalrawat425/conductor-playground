-- Email uniqueness is case-sensitive (trim whitespace only).
-- Replaces 012 indexes that used lower(trim(email)).

drop index if exists buyers_email_lower_unique;
drop index if exists sellers_email_lower_unique;

create unique index if not exists buyers_email_trim_unique
  on buyers (trim(email))
  where trim(coalesce(email, '')) <> '';

create unique index if not exists sellers_email_trim_unique
  on sellers (trim(email))
  where trim(coalesce(email, '')) <> '';
