-- Listings use pricing_options jsonb only; remove legacy single price + price_unit columns.

-- Backfill from legacy columns where json is missing or empty (runs before columns are dropped).
UPDATE fish_listings
SET pricing_options = jsonb_build_array(
  jsonb_build_object(
    'id', 'default',
    'label', case coalesce(price_unit, 'piece')
      when 'dozen' then 'Per dozen'
      when 'piece' then 'Per piece'
      else 'Per piece'
    end,
    'price', greatest(coalesce(price, 0)::numeric, 1),
    'unit', case when price_unit = 'dozen' then 'dozen' else 'piece' end
  )
)
WHERE pricing_options IS NULL
   OR pricing_options = 'null'::jsonb
   OR pricing_options = '[]'::jsonb
   OR jsonb_array_length(COALESCE(pricing_options, '[]'::jsonb)) = 0;

ALTER TABLE fish_listings ALTER COLUMN pricing_options SET NOT NULL;

ALTER TABLE fish_listings DROP COLUMN IF EXISTS price;
ALTER TABLE fish_listings DROP COLUMN IF EXISTS price_unit;
