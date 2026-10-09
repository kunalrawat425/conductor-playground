-- 076: close the buyer-contact leak.
--
-- "Buyers can view own orders by phone" was USING (true): anyone holding the
-- public anon key (it ships in the site's JavaScript) could read every order —
-- buyer phone, address, notes. Browser realtime subscriptions on `orders` rode
-- the same policy, so every seller's dashboard received every buyer's row.
--
-- Orders are now read only through server APIs that check a signed session
-- (src/lib/server/session.ts) and return sellers a masked view
-- (src/lib/seller-order-view.ts). Deploy that code before or with this.
-- The auth.uid()-based policies stay; they match nothing for anon.

drop policy if exists "Buyers can view own orders by phone" on public.orders;

-- Server-only functions that anon/authenticated could still EXECUTE. Table RLS
-- already blocks their writes for those roles; revoke so they cannot be probed.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_order_atomic', 'restore_order_stock', 'refresh_seller_stats')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Verify:
--   select count(*) from pg_policies where tablename = 'orders' and qual = 'true';   -- 0
--   anon: GET /rest/v1/orders?select=buyer_phone                                      -- []
