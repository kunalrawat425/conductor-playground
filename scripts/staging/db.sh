#!/usr/bin/env bash
# Staging DB runbook. Reads .context/staging.env (gitignored).
#   scripts/staging/db.sh backup     full pg_dump into .context/backups/
#   scripts/staging/db.sh drift      schema facts that differ between envs
#   scripts/staging/db.sh migrate    apply 069–072 (each in its own transaction, stop on error)
#   scripts/staging/db.sh test       run supabase/tests/069_072_db.test.sql (rolls back)
#   scripts/staging/db.sh fakes      list identity-less accounts (no name, email or address) — read-only
# Uses the postgres:17 image so no local psql/pg_dump install is needed.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . .context/staging.env; set +a
: "${STAGING_DATABASE_URL:?set STAGING_DATABASE_URL in .context/staging.env}"
PG="docker run --rm -i -v $PWD:/w -w /w postgres:17"

case "${1:-}" in
  backup)
    mkdir -p .context/backups
    out=".context/backups/staging-$(date +%Y%m%d-%H%M%S).dump"
    $PG pg_dump "$STAGING_DATABASE_URL" -Fc --no-owner --schema=public --schema=storage -f "/w/$out"
    ls -lh "$out" ;;
  drift)
    $PG psql "$STAGING_DATABASE_URL" -At -c "
      select 'orders cols: ' || string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='orders';
      select 'listing cols: ' || string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='fish_listings';
      select 'tables: ' || string_agg(tablename, ',' order by tablename) from pg_tables where schemaname='public';
      select 'triggers: ' || string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid='public.orders'::regclass and not tgisinternal;
      select 'bucket order-payments public=' || public from storage.buckets where id='order-payments';
      select 'counts: orders=' || (select count(*) from orders) || ' sellers=' || (select count(*) from sellers) || ' buyers=' || (select count(*) from buyers);" ;;
  migrate)
    for f in 069 070 071 072; do
      file=$(ls supabase/migrations/${f}_*.sql)
      echo "== $file"
      $PG psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -q -f "/w/$file"
    done ;;
  test)
    $PG psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f /w/supabase/tests/069_072_db.test.sql ;;
  fakes)
    $PG psql "$STAGING_DATABASE_URL" -c "
      select 'seller' kind, id, name, phone, (select count(*) from fish_listings l where l.seller_id=s.id) listings,
             (select count(*) from orders o join fish_listings l on l.id=o.listing_id where l.seller_id=s.id) orders
      from sellers s
      where coalesce(email,'')='' and coalesce(first_name,'')='' and coalesce(last_name,'')='' and coalesce(location,'')=''
      union all
      select 'buyer', id, coalesce(first_name,''), phone, 0, (select count(*) from orders o where o.buyer_id=b.id)
      from buyers b
      where coalesce(email,'')='' and coalesce(first_name,'')='' and coalesce(last_name,'')=''
        and not exists (select 1 from buyer_addresses a where a.buyer_id=b.id)
      order by 1, 6 desc;" ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
