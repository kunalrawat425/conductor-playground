-- Retire "gram": weight is expressed only in kg (use decimals, e.g. 0.5 kg).

-- Orders: quantity was in grams → kg
update public.orders
set
  quantity = round((quantity / 1000.0)::numeric, 4),
  quantity_unit = 'kg'
where quantity_unit = 'gram';

-- Listings: stock was in grams for gram-priced listings → kg
update public.fish_listings fl
set weight_avail = round((fl.weight_avail / 1000.0)::numeric, 4)
where fl.pricing_options is not null
  and (
    fl.pricing_options::text ilike '%"unit":"gram"%'
    or fl.pricing_options::text ilike '%"unit":"g"%'
  );

-- pricing_options: gram tiers → kg (bundle_size was grams → kg)
update public.fish_listings fl
set pricing_options = (
  select coalesce(jsonb_agg(
    case
      when (t.value->>'unit') in ('gram', 'g') then
        jsonb_set(
          jsonb_set(t.value, '{unit}', '"kg"'),
          '{bundle_size}',
          to_jsonb(
            greatest(
              0.01::numeric,
              round(
                (coalesce((t.value->>'bundle_size')::numeric, 1) / 1000.0)::numeric,
                4
              )
            )
          )
        )
      else t.value
    end
  ), '[]'::jsonb)
  from jsonb_array_elements(fl.pricing_options::jsonb) as t
)
where fl.pricing_options is not null
  and (
    fl.pricing_options::text ilike '%"unit":"gram"%'
    or fl.pricing_options::text ilike '%"unit":"g"%'
  );

update public.species_ranges
set price_unit = 'kg'
where price_unit = 'gram';

alter table public.orders drop constraint if exists orders_quantity_unit_check;

alter table public.orders
  add constraint orders_quantity_unit_check
    check (quantity_unit in ('kg', 'piece'));

alter table public.species_ranges drop constraint if exists species_ranges_price_unit_check;

alter table public.species_ranges
  add constraint species_ranges_price_unit_check
    check (price_unit in ('kg', 'piece'));
