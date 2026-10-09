-- 070: tables that drifted out of sync with each other (found auditing prod 2026-10-08)
--
-- 1. otp_attempts is dead. 018 created it for OTP rate limiting; 052 replaced it
--    with otp_codes and the code moved over, but the old table was never dropped.
--    Last write 2026-05-03; 5 of its 10 rows are for phones otp_codes has never
--    seen. Two tables claiming to hold attempt counts, one silently stale.
-- 2. otp_codes keeps every burned/expired code (plaintext) forever.
-- 3. Phone formats: buyers/sellers store 10 digits, otp_codes "91"+10, orders kept
--    whatever the client sent (218 "+91…", 117 10-digit). Code now normalises on
--    write (create.ts, create-seller-cart.ts, send/verify-otp); this backfills.
-- 4. sellers.rating_avg / total_orders are shown publicly (shop sort, search
--    ranking, the seller page's schema.org aggregateRating) but NOTHING wrote
--    them — 2 sellers' ratings and 5 sellers' counts disagreed with the data.
--    Now maintained by triggers; rating_count added for the review count.
-- 5. price_logs: no code reads or writes it, 0 rows.
--
-- Safe on staging and prod. Idempotent.

-- 1 + 5
drop table if exists public.otp_attempts;
drop table if exists public.price_logs;

-- 2: keep each phone's row only while it still matters for today's send limit.
delete from public.otp_codes where expires_at < now() - interval '1 day' and send_date < (now() at time zone 'Asia/Kolkata')::date;

-- 3
update public.orders
set buyer_phone = right(regexp_replace(buyer_phone, '\D', '', 'g'), 10)
where buyer_phone !~ '^[6-9][0-9]{9}$'
  and right(regexp_replace(buyer_phone, '\D', '', 'g'), 10) ~ '^[6-9][0-9]{9}$';

-- Prod had the same person twice in one area (+91… and 10-digit); normalizing
-- would break unique (phone, area). Keep the oldest row of each pair.
delete from public.buyer_waitlist w
using public.buyer_waitlist k
where right(regexp_replace(w.phone, '\D', '', 'g'), 10) = right(regexp_replace(k.phone, '\D', '', 'g'), 10)
  and w.area is not distinct from k.area
  and (k.created_at, k.id::text) < (w.created_at, w.id::text);

update public.buyer_waitlist
set phone = right(regexp_replace(phone, '\D', '', 'g'), 10)
where phone !~ '^[6-9][0-9]{9}$'
  and right(regexp_replace(phone, '\D', '', 'g'), 10) ~ '^[6-9][0-9]{9}$';

-- 4
alter table public.sellers add column if not exists rating_count integer not null default 0;

create or replace function public.refresh_seller_stats(p_seller_id uuid)
returns void
language sql
set search_path = public
as $$
  update sellers s set
    rating_avg   = coalesce((select round(avg(f.rating)::numeric, 2) from order_feedback f where f.seller_id = p_seller_id), 0),
    rating_count = (select count(*) from order_feedback f where f.seller_id = p_seller_id),
    total_orders = (select count(*) from orders o join fish_listings l on l.id = o.listing_id
                    where l.seller_id = p_seller_id and o.status in ('completed', 'picked_up'))
  where s.id = p_seller_id;
$$;

create or replace function public.trg_feedback_seller_stats()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform refresh_seller_stats(coalesce(new.seller_id, old.seller_id));
  if tg_op = 'UPDATE' and new.seller_id is distinct from old.seller_id then
    perform refresh_seller_stats(old.seller_id);
  end if;
  return null;
end;
$$;

create or replace function public.trg_order_seller_stats()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.status in ('completed', 'picked_up')) is distinct from (old.status in ('completed', 'picked_up')) then
    perform refresh_seller_stats((select seller_id from fish_listings where id = new.listing_id));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_feedback_seller_stats on public.order_feedback;
create trigger trg_feedback_seller_stats
  after insert or update or delete on public.order_feedback
  for each row execute function public.trg_feedback_seller_stats();

drop trigger if exists trg_order_seller_stats on public.orders;
create trigger trg_order_seller_stats
  after update of status on public.orders
  for each row execute function public.trg_order_seller_stats();

revoke execute on function public.refresh_seller_stats(uuid) from anon, authenticated;

select public.refresh_seller_stats(id) from public.sellers;

-- Verify (expect 0 each):
--   select count(*) from orders where buyer_phone !~ '^[6-9][0-9]{9}$';           -- prod: 2 unparseable test rows remain
--   select count(*) from sellers s where rating_count <> (select count(*) from order_feedback f where f.seller_id = s.id);
--   select to_regclass('public.otp_attempts');                                     -- null
