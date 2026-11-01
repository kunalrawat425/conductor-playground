-- No spam (founder, 1 Nov 2026): at most 2 reminder/promo SMS per phone number in any 7 days.
-- Enforced in the database so every sender (cron, scripts, manual inserts) obeys it: a 3rd row is refused
-- before it is written, and the app only sends after its row is written, so nothing goes out.
-- Counts kinds promo, act_signup, act_cart, act_unpaid on channel 'sms' with a live status.
-- Not counted: order updates (confirmed / out for delivery / cancelled), test_* rows, login codes.
create or replace function message_log_sms_weekly_cap() returns trigger
language plpgsql as $$
begin
  if (select count(*) from message_log m
      where m.channel = 'sms'
        and m.to_phone = new.to_phone
        and m.kind in ('promo', 'act_signup', 'act_cart', 'act_unpaid')
        and m.status in ('queued', 'sent', 'delivered', 'read')
        and m.created_at > now() - interval '7 days') >= 2 then
    raise exception 'sms_weekly_cap: % already has 2 reminder/promo SMS in the last 7 days', right(new.to_phone, 4)
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists message_log_sms_weekly_cap on message_log;
create trigger message_log_sms_weekly_cap
  before insert on message_log
  for each row
  when (new.channel = 'sms' and new.kind in ('promo', 'act_signup', 'act_cart', 'act_unpaid'))
  execute function message_log_sms_weekly_cap();

create index if not exists message_log_sms_phone_recent on message_log (to_phone, created_at) where channel = 'sms';
