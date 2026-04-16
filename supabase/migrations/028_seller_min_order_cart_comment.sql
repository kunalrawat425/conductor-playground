-- Clarify: minimum applies to combined cart subtotal at checkout (see /api/orders/create-seller-cart)

comment on column sellers.min_order_amount is 'Minimum cart subtotal (₹) for a buyer checkout at this seller; 0 = no minimum';
