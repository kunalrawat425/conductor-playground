-- Campaign attribution on orders (flyer QR, blog links, ads).
-- Written best-effort by /api/orders/create-seller-cart from the buyer's last-touch UTM.
-- Nullable, no default: metadata-only change. Fail fast instead of queueing behind live checkout locks.
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS utm_source   text,
  ADD COLUMN IF NOT EXISTS utm_medium   text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content  text;
