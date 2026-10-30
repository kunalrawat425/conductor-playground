-- 088: messaging v2 (founder 30 Oct 2026). WhatsApp for opted-in buyers, SMS (MSG91) for everyone
-- else; activity reminders (sign-up 1 h, cart 1 h, unpaid 30 min) + promos, one channel per message.
--
-- buyers.dnd_at: the founder's do-not-message list. No reminders or promos on any channel; order
--   updates about an order they placed still go out.
-- message_log.short_id: 10-char code for SMS links (/go/<short_id>). A DLT variable is max 30 chars,
--   so the full uuid doesn't fit.
-- message_log.payload: what was sent ({template, body, sms:{key, vars}}), so a WhatsApp message that
--   Wati later reports as failed can be re-sent once by SMS with the same values.

alter table public.buyers add column if not exists dnd_at timestamptz;

alter table public.message_log add column if not exists short_id text
  default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
create unique index if not exists message_log_short_id on public.message_log (short_id);
alter table public.message_log add column if not exists payload jsonb;
create index if not exists message_log_status_recent on public.message_log (channel, status, created_at);

-- DND list (founder, 24–25 Oct). 9967743841 hasn't signed up; the engine also checks this list by phone.
update public.buyers set dnd_at = coalesce(dnd_at, now())
 where right(regexp_replace(phone, '\D', '', 'g'), 10) in ('9923753706', '9867325848', '9820027803', '9967743841');

-- The 10-minute tick is NOT created here (it needs the environment's URL and secret). Run once per
-- environment, as the postgres role, after storing the cron secret in Vault:
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   select vault.create_secret('<CRON_SECRET>', 'messaging_cron_secret');
--   select cron.schedule('messaging-tick', '*/10 * * * *', $$
--     select net.http_get(
--       url := 'https://www.relifish.com/api/cron/messaging',
--       headers := jsonb_build_object('Authorization', 'Bearer ' ||
--         (select decrypted_secret from vault.decrypted_secrets where name = 'messaging_cron_secret')),
--       timeout_milliseconds := 55000)
--   $$);
