-- Separate same-day and pre-order carts. The same listing + price tier can sit in
-- both (cart key includes the mode), so the server row key needs the mode too.
-- Constant default: metadata-only column add. Rows saved before this are same-day,
-- which is what the client assumes for lines without a mode.
-- /api/buyer/cart falls back to the 3-column key while this is not applied.
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.buyer_cart
  ADD COLUMN IF NOT EXISTS placement_kind text NOT NULL DEFAULT 'same_day'
  CHECK (placement_kind IN ('same_day', 'preorder'));
-- 071 made the old key a constraint; drop the index form too in case it was created by hand.
ALTER TABLE public.buyer_cart DROP CONSTRAINT IF EXISTS buyer_cart_buyer_listing_option_key;
DROP INDEX IF EXISTS public.buyer_cart_buyer_listing_option_key;
CREATE UNIQUE INDEX IF NOT EXISTS buyer_cart_buyer_listing_option_mode_key
  ON public.buyer_cart (buyer_id, listing_id, pricing_option_id, placement_kind);
