-- One checkout = one cart. A multi-item cart still writes one order row per item
-- (stock, seller actions and refunds stay per item), but every row of the same
-- checkout shares cart_id so the buyer pays once, both parties get one
-- notification, and the seller sees one order.
-- Nullable, no default: metadata-only change. Rows without it behave as before.
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cart_id uuid;
CREATE INDEX IF NOT EXISTS orders_cart_id_idx ON public.orders (cart_id) WHERE cart_id IS NOT NULL;
