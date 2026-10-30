-- Funnel steps in our own DB (founder, 26 Oct): landing → seller page → login shown → phone entered (OTP sent)
-- → OTP resend / failed / verified → add to cart → checkout. Paid comes from orders. Written only by /api/track
-- (service role); no public read. internal = team devices (?rf_internal=1), excluded from reports.
create table if not exists public.funnel_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  event text not null check (event in ('landing','shop_view','seller_view','login_shown','otp_sent','otp_resend','otp_failed','otp_verified','add_to_cart','checkout_started')),
  visitor_id text,
  buyer_id uuid,
  path text,
  seller_id uuid,
  source text,
  internal boolean not null default false,
  meta jsonb
);
create index if not exists funnel_events_at_idx on public.funnel_events (at);
create index if not exists funnel_events_event_at_idx on public.funnel_events (event, at);
alter table public.funnel_events enable row level security;

-- Daily people per step (IST), team devices excluded. security_invoker keeps the table's RLS (no public read).
create or replace view public.funnel_daily with (security_invoker = true) as
select (at at time zone 'Asia/Kolkata')::date as day, event,
       count(*) as events,
       count(distinct coalesce(visitor_id, buyer_id::text)) as people
from public.funnel_events
where not internal
group by 1, 2;
