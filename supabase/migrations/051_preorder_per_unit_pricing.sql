-- Migrate pre-order price range from global listing columns to per-unit pricing_options JSONB.
-- Drop unused preorder_min_qty / preorder_max_qty (spec: pre-orders have no quantity limit).
-- Add is_order_paused: lets seller pause a listing for same-day orders while keeping pre-order menu.

-- Step 1: Copy existing global preorder_price_min/max into pricing_options[0] of each listing
UPDATE fish_listings
SET pricing_options = (
  SELECT jsonb_agg(
    CASE WHEN pos = 0 THEN
      opt
      || jsonb_build_object('preorder_price_min', fish_listings.preorder_price_min)
      || jsonb_build_object('preorder_price_max', fish_listings.preorder_price_max)
    ELSE opt
    END
  )
  FROM jsonb_array_elements(fish_listings.pricing_options) WITH ORDINALITY AS t(opt, pos)
)
WHERE pricing_options IS NOT NULL
  AND jsonb_array_length(pricing_options) > 0
  AND (preorder_price_min IS NOT NULL OR preorder_price_max IS NOT NULL);

-- Step 2: Drop old global columns
ALTER TABLE fish_listings
  DROP COLUMN IF EXISTS preorder_price_min,
  DROP COLUMN IF EXISTS preorder_price_max,
  DROP COLUMN IF EXISTS preorder_min_qty,
  DROP COLUMN IF EXISTS preorder_max_qty;

-- Step 3: Add is_order_paused flag
ALTER TABLE fish_listings
  ADD COLUMN IF NOT EXISTS is_order_paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fish_listings.is_order_paused IS
  'When true, listing is hidden from same-day order menu but still visible in pre-order menu when is_preorder_enabled=true';
