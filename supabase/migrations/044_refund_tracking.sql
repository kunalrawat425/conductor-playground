-- Refund tracking: seller marks when UPI refund was sent to buyer
alter table orders
  add column if not exists refund_note text,
  add column if not exists refund_sent_at timestamptz;

comment on column orders.refund_note is 'Seller note when marking refund as sent (e.g. UTR number or message)';
comment on column orders.refund_sent_at is 'Timestamp when seller marked refund as sent to buyer';
