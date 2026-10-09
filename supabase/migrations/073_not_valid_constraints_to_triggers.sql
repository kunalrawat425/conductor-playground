-- 073: fix 072's NOT VALID constraints.
--
-- A NOT VALID CHECK only skips existing rows at creation time; Postgres still
-- enforces it on every later UPDATE of an old row. Found on staging: flagging a
-- legacy cancelled order failed on orders_cancel_has_actor. Left as-is, any cron
-- note, refund retry or status change on the 7 legacy cancellations (or the few
-- legacy junk phones) would have failed.
--
--   cancel actor  → legacy rows get cancelled_by = 'unknown' (honest: the actor
--                   was never recorded), then the constraint is fully validated.
--   phone format  → a trigger that runs only when a phone is written (insert, or
--                   update OF the phone column) normalises to 10 digits and rejects
--                   anything else. Untouched legacy rows stay updatable.
-- Idempotent. Run after 072.

alter table public.orders drop constraint if exists orders_cancelled_by_values;
alter table public.orders add constraint orders_cancelled_by_values
  check (cancelled_by is null or cancelled_by in ('buyer', 'seller', 'system', 'admin', 'unknown'));

update public.orders set cancelled_by = 'unknown'
where status in ('cancelled', 'declined') and cancelled_by is null;
alter table public.orders validate constraint orders_cancel_has_actor;

alter table public.orders  drop constraint if exists orders_buyer_phone_format;
alter table public.buyers  drop constraint if exists buyers_phone_format;
alter table public.sellers drop constraint if exists sellers_phone_format;

create or replace function public.normalize_indian_mobile()
returns trigger
language plpgsql
set search_path = public
as $$
-- tg_argv[0] = the phone column. Read/write by name (a CASE over new.buyer_phone /
-- new.phone fails to compile on the table that lacks one of them).
declare col text := tg_argv[0]; raw text; d text;
begin
  raw := to_jsonb(new) ->> col;
  d := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
  if length(d) = 12 and d like '91%' then d := substr(d, 3); end if;
  if length(d) = 11 and d like '0%' then d := substr(d, 2); end if;
  if d !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid Indian mobile number: %', raw using errcode = '23514';
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(col, d));
  return new;
end;
$$;

drop trigger if exists trg_orders_phone on public.orders;
create trigger trg_orders_phone before insert or update of buyer_phone on public.orders
  for each row execute function public.normalize_indian_mobile('buyer_phone');
drop trigger if exists trg_buyers_phone on public.buyers;
create trigger trg_buyers_phone before insert or update of phone on public.buyers
  for each row execute function public.normalize_indian_mobile('phone');
drop trigger if exists trg_sellers_phone on public.sellers;
create trigger trg_sellers_phone before insert or update of phone on public.sellers
  for each row execute function public.normalize_indian_mobile('phone');

-- Verify: every NOT VALID constraint left is gone
--   select conrelid::regclass, conname from pg_constraint
--   where connamespace = 'public'::regnamespace and not convalidated;   -- expect 0 rows
