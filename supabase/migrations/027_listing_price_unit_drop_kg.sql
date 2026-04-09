-- App pricing is piece|dozen only; legacy listings may still have price_unit = 'kg'.
update fish_listings
set price_unit = 'piece'
where price_unit = 'kg';
