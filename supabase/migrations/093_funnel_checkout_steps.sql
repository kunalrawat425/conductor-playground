-- Checkout steps in our own funnel log (3 Nov 2026): GA missed some buyers entirely, and checkout's own
-- guards (no address, no slot, below minimum...) only showed a toast, so we could not see where people stop.
alter table public.funnel_events drop constraint if exists funnel_events_event_check;
alter table public.funnel_events add constraint funnel_events_event_check check (event in (
  'landing','shop_view','seller_view','login_shown','otp_sent','otp_resend','otp_failed','otp_verified','add_to_cart','checkout_started',
  'checkout_step2','checkout_closed','place_order_tap','checkout_blocked','order_created','order_failed','pay_opened','pay_dismissed','pay_failed'));
