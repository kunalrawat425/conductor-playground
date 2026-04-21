-- Seller can upload proof of UPI refund transfer
alter table orders
  add column if not exists refund_screenshot_path text;

comment on column orders.refund_screenshot_path is 'Storage path of seller-uploaded refund proof screenshot (order-payments bucket)';
