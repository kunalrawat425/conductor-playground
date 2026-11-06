-- Closed dates (founder, 6 Nov 2026): IST dates a seller takes no orders and makes no deliveries
-- (holidays, festivals, no catch). The shop stays open for other days: e.g. Nomadic Catch closed
-- Sun 8 + Wed 11 Nov still takes pre-orders for Sun 15. Read by src/lib/order-timing.ts (isClosedDateMs).
alter table public.sellers add column if not exists closed_dates date[] not null default '{}'::date[];
-- Storefront column: readable by the public key like the other timing columns (see 085).
grant select (closed_dates) on public.sellers to anon, authenticated;
