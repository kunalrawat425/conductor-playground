-- Add Razorpay payment columns to orders table.
-- These are required by the razorpay-create-order and razorpay-verify API endpoints.

alter table orders
  add column if not exists razorpay_order_id text,
  add column if not exists razorpay_payment_id text,
  add column if not exists payment_method text;

comment on column orders.razorpay_order_id is 'Razorpay order ID (rzp_order_*) stored after razorpay-create-order call. Used for idempotency and replay-attack prevention.';
comment on column orders.razorpay_payment_id is 'Razorpay payment ID (pay_*) stored after successful razorpay-verify call.';
comment on column orders.payment_method is 'Payment method used: "razorpay" for online payments, NULL for manual UPI/bank-transfer screenshot flow.';
