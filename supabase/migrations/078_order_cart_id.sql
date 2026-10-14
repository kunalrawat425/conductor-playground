-- One checkout = one cart. A multi-item cart still writes one order row per item
-- (stock, seller actions and refunds stay per item), but every row of the same
-- checkout shares cart_id so the buyer pays once, both parties get one
-- notification, and the seller sees one order.
-- Nullable, no default: metadata-only change. Rows without it behave as before.
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cart_id uuid;
CREATE INDEX IF NOT EXISTS orders_cart_id_idx ON public.orders (cart_id) WHERE cart_id IS NOT NULL;

-- 069 allowed one order row per Razorpay order / payment. A cart is paid once for
-- all its rows, so the rule becomes: rows sharing a Razorpay order or payment must
-- be the SAME cart (a row without cart_id is its own cart, so single orders keep
-- the old one-row guarantee).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS ex_orders_razorpay_order_one_cart;
ALTER TABLE public.orders ADD CONSTRAINT ex_orders_razorpay_order_one_cart
  EXCLUDE USING gist (razorpay_order_id WITH =, (coalesce(cart_id::text, id::text)) WITH <>)
  WHERE (razorpay_order_id IS NOT NULL);
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS ex_orders_razorpay_payment_one_cart;
ALTER TABLE public.orders ADD CONSTRAINT ex_orders_razorpay_payment_one_cart
  EXCLUDE USING gist (razorpay_payment_id WITH =, (coalesce(cart_id::text, id::text)) WITH <>)
  WHERE (razorpay_payment_id IS NOT NULL);
DROP INDEX IF EXISTS public.uq_orders_razorpay_order_id;
DROP INDEX IF EXISTS public.uq_orders_razorpay_payment_id;

-- Rollback (only while no cart shares a Razorpay id):
--   alter table orders drop constraint ex_orders_razorpay_order_one_cart, drop constraint ex_orders_razorpay_payment_one_cart;
--   create unique index uq_orders_razorpay_order_id on orders(razorpay_order_id) where razorpay_order_id is not null;
--   create unique index uq_orders_razorpay_payment_id on orders(razorpay_payment_id) where razorpay_payment_id is not null;
--   drop index orders_cart_id_idx; alter table orders drop column cart_id;
