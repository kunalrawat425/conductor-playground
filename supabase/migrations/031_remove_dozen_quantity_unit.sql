-- Retire "dozen": map legacy rows to piece; constrain to piece | kg | gram.
update public.orders
set quantity_unit = 'piece'
where quantity_unit = 'dozen';

alter table public.orders drop constraint if exists orders_quantity_unit_check;

alter table public.orders
  add constraint orders_quantity_unit_check
  check (quantity_unit in ('kg', 'piece', 'gram'));

-- Normalize pricing_options jsonb: unit "dozen" -> "piece"
update public.fish_listings fl
set pricing_options = (
  select jsonb_agg(
    case
      when (t.value->>'unit') = 'dozen' then t.value || jsonb_build_object('unit', 'piece')
      else t.value
    end
  )
  from jsonb_array_elements(fl.pricing_options) as t
)
where fl.pricing_options is not null
  and fl.pricing_options::text like '%dozen%';

update public.species_ranges
set price_unit = 'piece'
where price_unit = 'dozen';

alter table public.species_ranges drop constraint if exists species_ranges_price_unit_check;

alter table public.species_ranges
  add constraint species_ranges_price_unit_check
  check (price_unit in ('kg', 'piece', 'gram'));
